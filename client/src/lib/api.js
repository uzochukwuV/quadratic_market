/**
 * Read-only / quote API client for the Quadratic Market bot backend.
 *
 * All endpoints are read-only - the user signs buy/sell/etc. with their own wallet.
 * The frontend never holds a server keypair.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8081';

async function postJSON(path, body) {
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

async function getJSON(path) {
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
  useQuery({ queryKey: ['markets'], queryFn: listMarkets, refetchInterval: 30_000 });

export const useMarket = (marketId) =>
  useQuery({
    queryKey: ['market', marketId],
    queryFn: () => getMarket(marketId),
    enabled: !!marketId,
    refetchInterval: 30_000,
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

export const useUserBetHistory = (wallet, opts) =>
  useQuery({
    queryKey: ['userBetHistory', wallet, opts],
    queryFn: () => getUserBetHistory(wallet, opts),
    enabled: !!wallet,
    refetchInterval: 60_000,
  });
