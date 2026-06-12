/**
 * Read-only / quote API client for the Quadratic Market bot backend.
 * Updated to use TypeScript server on port 3000.
 *
 * All endpoints are read-only - the user signs buy/sell/etc. with their own wallet.
 * The frontend never holds a server keypair.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `${path} failed: ${res.status}`);
  }
  return res.json();
}

// ─── Health & Protocol State ────────────────────────────────────

export const getHealth = () => getJSON('/health');

export const getProtocolConfig = () => getJSON('/protocol-config');

export const getGlobalConfig = () => getJSON('/view-global-config');

// ─── Markets ─────────────────────────────────────────────────────

export const listMarkets = () => getJSON('/markets');

export const getMarket = (marketId) => getJSON(`/view-market/${marketId}`);

export const getOddsTable = () => getJSON('/odds-table');

// ─── Quotes (read-only LMSR math) ───────────────────────────────

// These still need to be implemented on the TS server
export const quoteBuy = async (marketId, outcomeId, numShares) => {
  const market = await getMarket(marketId);
  const qValues = market.qValues;
  const sumQ = qValues.reduce((a, b) => a + b, 0);
  const q0 = qValues[outcomeId] || 50000000;
  // LMSR cost approximation
  const cost = Math.ceil(numShares * (1e9 / q0) * 1.05); // 5% margin
  return { cost, maxShares: Math.floor(q0 * 0.1) };
};

export const quoteSell = quoteBuy; // Same calculation
export const quoteSlip = async (marketIds, outcomes, sharesPerLeg) => {
  let totalCost = 0;
  for (let i = 0; i < marketIds.length; i++) {
    const q = await quoteBuy(marketIds[i], outcomes[i], sharesPerLeg);
    totalCost += q.cost;
  }
  return { cost: totalCost, maxShares: sharesPerLeg };
};

// ─── User Positions & Bet Slips ──────────────────────────────────

export const getUserPositions = (wallet) =>
  postJSON('/user_positions', { wallet });

export const getUserSlips = (wallet, { startId = 1, endId = 50, onlyOpen = true } = {}) =>
  postJSON('/user_slips', {
    wallet,
    start_id: startId,
    end_id: endId,
    only_open: onlyOpen,
  });

export const getUserBetHistory = (wallet, { startId = 1, endId = 100, onlySettled = false } = {}) =>
  postJSON('/user_bet_history', {
    wallet,
    start_id: startId,
    end_id: endId,
    only_settled: onlySettled,
  });

export const getBetSlip = (slipId) => postJSON('/bet_slip', { slip_id: slipId });

export const quoteCashOut = (slipId, marketIds) =>
  postJSON('/view_cash_out_value', { slip_id: slipId, market_ids: marketIds });

// ─── LP Stats ────────────────────────────────────────────────────

export const getLpStats = () => postJSON('/view_lp_stats', {});

// ─── React Query Hooks ───────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';

export const useMarkets = () =>
  useQuery({ queryKey: ['markets'], queryFn: getOddsTable, refetchInterval: 60_000, staleTime: 30_000 });

export const useMarket = (marketId) =>
  useQuery({
    queryKey: ['market', marketId],
    queryFn: () => getMarket(marketId),
    enabled: !!marketId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const useGlobalConfig = () =>
  useQuery({ queryKey: ['globalConfig'], queryFn: getProtocolConfig, refetchInterval: 120_000, staleTime: 60_000 });

export const useProtocolConfig = () =>
  useQuery({ queryKey: ['protocolConfig'], queryFn: getProtocolConfig, staleTime: 60_000 });

export const useUserPositions = (wallet) =>
  useQuery({
    queryKey: ['userPositions', wallet],
    queryFn: () => getUserPositions(wallet),
    enabled: !!wallet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const useUserSlips = (wallet, opts) =>
  useQuery({
    queryKey: ['userSlips', wallet, opts],
    queryFn: () => getUserSlips(wallet, opts),
    enabled: !!wallet,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

export const useUserBetHistory = (wallet, opts) =>
  useQuery({
    queryKey: ['userBetHistory', wallet, opts],
    queryFn: () => getUserBetHistory(wallet, opts),
    enabled: !!wallet,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

// ─── Live market data mapper ─────────────────────────────────────

import { useMemo } from 'react';

/** Format timestamp as countdown */
function formatCountdown(startTime) {
  if (!startTime) return '—';
  const now = Math.floor(Date.now() / 1000);
  const secs = startTime - now;
  if (secs <= 0) return 'LIVE';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Maps /odds-table response to sportsData-compatible shapes.
 */
function mapOddsTableToSportsData(oddsData) {
  if (!oddsData?.markets) return { matchesByLeague: [], liveMatches: [] };

  const grouped = new Map();
  const liveMatches = [];

  for (const m of oddsData.markets) {
    if (!m.isActive) continue;

    const match = {
      id: `mkt-${m.marketId}`,
      marketId: m.marketId,
      time: formatCountdown(oddsData.fixture?.startTime),
      home: oddsData.fixture?.homeTeam || 'Team A',
      away: oddsData.fixture?.awayTeam || 'Team B',
      odds: {},
      more: 0,
      status: 'Open',
      numOutcomes: m.outcomes.length,
      outcomeMints: [],
      qValues: m.outcomes.map(o => o.qValue),
    };

    // Build odds map
    if (m.outcomes.length === 3) {
      match.odds['1'] = m.outcomes[0]?.odds || 0;
      match.odds['X'] = m.outcomes[1]?.odds || 0;
      match.odds['2'] = m.outcomes[2]?.odds || 0;
    } else if (m.outcomes.length === 2) {
      match.odds['1'] = m.outcomes[0]?.odds || 0;
      match.odds['2'] = m.outcomes[1]?.odds || 0;
    }

    const league = m.marketTypeName || 'Market';
    if (!grouped.has(league)) grouped.set(league, []);
    grouped.get(league).push(match);

    liveMatches.push({
      ...match,
      league,
      minute: '—',
      homeScore: '—',
      awayScore: '—',
    });
  }

  const matchesByLeague = Array.from(grouped.entries()).map(([league, matches]) => ({
    league,
    matches,
  }));

  return { matchesByLeague, liveMatches };
}

export function useLiveMarkets() {
  const { data, isLoading, error, refetch } = useMarkets();
  const mapped = useMemo(() => mapOddsTableToSportsData(data), [data]);
  return { ...mapped, isLoading, error, refetch };
}
