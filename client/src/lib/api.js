/**
 * Read-only / quote API client for the Quadratic Market bot backend.
 *
 * All endpoints are read-only - the user signs buy/sell/etc. with their own wallet.
 * The frontend never holds a server keypair.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8081';

export async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${path} failed: ${res.status}`);
  }
  return res.json();
}

// ─── Health & Protocol State ────────────────────────────────────

export const getHealth = () => getJSON('/health');

export const getGlobalConfig = () => getJSON('/view_global_config');

// ─── Markets ─────────────────────────────────────────────────────

export const listMarkets = () => getJSON('/markets');

export const getMarket = (marketId) => getJSON(`/markets/${marketId}`);

export const getMarketStats = (marketId) =>
  postJSON('/view_market_stats', { market_id: marketId });

// ─── Quotes (read-only LMSR math) ───────────────────────────────

export const quoteBuy = (marketId, outcomeId, numShares) =>
  postJSON('/view_quote_buy', {
    market_id: marketId,
    outcome_id: outcomeId,
    num_shares: numShares,
  });

export const quoteSell = (marketId, outcomeId, numShares) =>
  postJSON('/view_quote_sell', {
    market_id: marketId,
    outcome_id: outcomeId,
    num_shares: numShares,
  });

export const quoteSlip = (marketIds, outcomes, sharesPerLeg) =>
  postJSON('/view_quote_slip', {
    market_ids: marketIds,
    outcomes: outcomes,
    shares_per_leg: sharesPerLeg,
  });

// ─── LP Stats ────────────────────────────────────────────────────

export const getLpStats = () => postJSON('/view_lp_stats', {});

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

// ─── React Query Hooks ───────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';

export const useMarkets = () =>
  useQuery({ queryKey: ['markets'], queryFn: listMarkets, refetchInterval: 60_000, staleTime: 30_000 });

export const useMarket = (marketId) =>
  useQuery({
    queryKey: ['market', marketId],
    queryFn: () => getMarket(marketId),
    enabled: !!marketId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const useMarketStats = (marketId) =>
  useQuery({
    queryKey: ['marketStats', marketId],
    queryFn: () => getMarketStats(marketId),
    enabled: !!marketId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const useGlobalConfig = () =>
  useQuery({ queryKey: ['globalConfig'], queryFn: getGlobalConfig, refetchInterval: 120_000, staleTime: 60_000 });

export const useLpStats = () =>
  useQuery({ queryKey: ['lpStats'], queryFn: getLpStats, refetchInterval: 120_000, staleTime: 60_000 });

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

export const useMarketStats = (marketId) =>
  useQuery({
    queryKey: ['marketStats', marketId],
    queryFn: () => getMarketStats(marketId),
    enabled: !!marketId,
    refetchInterval: 30_000,
  });

export const useGlobalConfig = () =>
  useQuery({ queryKey: ['globalConfig'], queryFn: getGlobalConfig, refetchInterval: 60_000 });

export const useLpStats = () =>
  useQuery({ queryKey: ['lpStats'], queryFn: getLpStats, refetchInterval: 60_000 });

export const useUserPositions = (wallet) =>
  useQuery({
    queryKey: ['userPositions', wallet],
    queryFn: () => getUserPositions(wallet),
    enabled: !!wallet,
    refetchInterval: 30_000,
  });

export const useUserSlips = (wallet, opts) =>
  useQuery({
    queryKey: ['userSlips', wallet, opts],
    queryFn: () => getUserSlips(wallet, opts),
    enabled: !!wallet,
    refetchInterval: 15_000,
  });

export const getProtocolConfig = () => getJSON('/protocol_config');

export const useProtocolConfig = () =>
  useQuery({ queryKey: ['protocolConfig'], queryFn: getProtocolConfig, staleTime: 60_000 });

// ─── Option B: Live market data mapped to sportsData-compatible shapes ────────
//
// Converts the raw /markets response into the exact shapes that OddsTable
// (matchesByLeague) and LiveMatches (liveMatches) already consume, so no
// other UI code needs to change.

import { useMemo } from 'react';

/**
 * Parses a market title into home/away team names.
 * Splits on " vs " or " - " and uses the first two parts.
 */
function parseTitleToTeams(title = '') {
  const vsIdx = title.search(/ vs /i);
  const dashIdx = title.indexOf(' - ');
  const splitIdx = vsIdx !== -1 ? vsIdx : dashIdx;
  if (splitIdx === -1) return { home: title, away: '' };
  const sep = vsIdx !== -1 ? ' vs ' : ' - ';
  const parts = title.split(sep);
  return { home: parts[0]?.trim() || title, away: parts[1]?.trim() || '' };
}

/** Format seconds-to-start as a match time string. */
function formatCountdown(secs) {
  if (typeof secs !== 'number') return '—';
  if (secs <= 0) return 'LIVE';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Convert current_odds (×10000 integers) to a decimal odds object keyed "1"/"X"/"2" etc. */
function buildOddsMap(currentOdds = [], numOutcomes = 0) {
  const map = {};
  const keys3 = ['1', 'X', '2'];
  const keys2 = ['1', '2'];
  const keys = numOutcomes >= 3 ? keys3 : keys2;
  for (let i = 0; i < Math.min(numOutcomes, keys.length); i++) {
    const raw = currentOdds[i];
    if (raw && raw > 0) map[keys[i]] = raw / 10000;
  }
  return map;
}

/**
 * Maps the /markets API response to the sportsData-compatible shapes.
 *
 * Returns:
 *   matchesByLeague — [{ league, matches: [{ id, time, home, away, odds, more, marketId, outcomeMints }] }]
 *   liveMatches     — same as above but for status=Open markets, in LiveMatches card format
 */
function mapMarketsToSportsData(marketsData) {
  if (!marketsData?.markets) return { matchesByLeague: [], liveMatches: [] };

  const grouped = new Map();
  const liveMatches = [];

  for (const m of marketsData.markets) {
    const { home, away } = parseTitleToTeams(m.title);
    const odds = buildOddsMap(m.current_odds, m.num_outcomes);
    const numOdds = Object.keys(odds).length;
    if (numOdds === 0) continue;

    const match = {
      id: `mkt-${m.market_id}`,
      marketId: m.market_id,
      time: formatCountdown(m.time_to_close),
      home,
      away: away || '—',
      odds,
      more: Math.max(0, (m.outcome_mints?.length || 0) - numOdds),
      status: m.status,
      numOutcomes: m.num_outcomes,
      outcomeMints: m.outcome_mints || [],
      qValues: m.q_values || [],
    };

    const league = m.category || 'Market';
    if (!grouped.has(league)) grouped.set(league, []);
    grouped.get(league).push(match);

    // Treat any market with odds as "live" for the LiveMatches carousel
    liveMatches.push({
      ...match,
      league,
      minute: m.status,
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

/**
 * Returns live market data in the sportsData-compatible shape.
 * Refreshes every 30 s.
 */
export function useLiveMarkets() {
  const { data, isLoading, error, refetch } = useMarkets();
  const mapped = useMemo(() => mapMarketsToSportsData(data), [data]);
  return { ...mapped, isLoading, error, refetch };
}
