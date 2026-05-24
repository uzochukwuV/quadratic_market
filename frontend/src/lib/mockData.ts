import type {
  EpochAccount,
  MarketAccount,
  BetSlipAccount,
  LimitOrderAccount,
  MyPosition,
  PendingLiquidityAccount,
  WithdrawalRequestAccount,
  LPEpochPosition,
  P2PAuction,
  PnLPoint,
} from "./types";

// ─── Epochs ──────────────────────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;

export const EPOCHS: EpochAccount[] = [
  {
    epoch_id: 3,
    start_time: now - 12 * DAY,
    end_time: now + 18 * DAY,
    total_liquidity_added: 42_800_000_000,
    total_liquidity_removed: 0,
    num_markets: 8,
    num_settled_markets: 2,
    all_markets_settled: false,
    withdrawals_enabled: false,
    lp_shares_at_close: 0,
  },
  {
    epoch_id: 2,
    start_time: now - 42 * DAY,
    end_time: now - 12 * DAY,
    total_liquidity_added: 38_100_000_000,
    total_liquidity_removed: 38_900_000_000,
    num_markets: 6,
    num_settled_markets: 6,
    all_markets_settled: true,
    withdrawals_enabled: true,
    lp_shares_at_close: 10_000_000,
  },
  {
    epoch_id: 1,
    start_time: now - 72 * DAY,
    end_time: now - 42 * DAY,
    total_liquidity_added: 22_000_000_000,
    total_liquidity_removed: 22_400_000_000,
    num_markets: 4,
    num_settled_markets: 4,
    all_markets_settled: true,
    withdrawals_enabled: true,
    lp_shares_at_close: 6_000_000,
  },
];

export const CURRENT_EPOCH = EPOCHS[0];

// ─── Markets ─────────────────────────────────────────────────────────────────
export const MARKETS: MarketAccount[] = [
  // ── Epoch 3 — current ──────────────────────────────────────
  {
    market_id: 301, epoch_id: 3,
    title: "Will Bitcoin close above $120,000 before Dec 31, 2026?",
    description: "Resolves YES if BTC closes above $120,000 on Binance or Coinbase before Jan 1, 2027.",
    category: "Crypto", status: "Open", market_mode: "Trading", num_outcomes: 2,
    q_values: [68_000_000, 32_000_000], lmsr_b: 50_000_000, exposure: 12_000_000,
    start_time: now - 10 * DAY, settlement_time: now + 220 * DAY, winning_outcome: 255,
  },
  {
    market_id: 302, epoch_id: 3,
    title: "Will Solana reach $1,000 by end of 2026?",
    description: "Resolves YES if SOL/USD spot price hits $1,000 on any major CEX before Jan 1, 2027.",
    category: "Crypto", status: "Open", market_mode: "Trading", num_outcomes: 2,
    q_values: [43_000_000, 57_000_000], lmsr_b: 50_000_000, exposure: 9_800_000,
    start_time: now - 10 * DAY, settlement_time: now + 220 * DAY, winning_outcome: 255,
  },
  {
    market_id: 303, epoch_id: 3,
    title: "Will Argentina win the 2026 FIFA World Cup?",
    description: "Resolves YES if Argentina is crowned champion at the 2026 FIFA World Cup.",
    category: "Sports", status: "Open", market_mode: "FixedOdds", num_outcomes: 2,
    q_values: [22_000_000, 78_000_000], lmsr_b: 50_000_000, exposure: 6_200_000,
    start_time: now - 8 * DAY, settlement_time: now + 56 * DAY, winning_outcome: 255, group_id: 101,
  },
  {
    market_id: 304, epoch_id: 3,
    title: "Will Brazil win the 2026 FIFA World Cup?",
    description: "Resolves YES if Brazil is crowned champion at the 2026 FIFA World Cup.",
    category: "Sports", status: "Open", market_mode: "FixedOdds", num_outcomes: 2,
    q_values: [18_000_000, 82_000_000], lmsr_b: 50_000_000, exposure: 5_100_000,
    start_time: now - 8 * DAY, settlement_time: now + 56 * DAY, winning_outcome: 255, group_id: 101,
  },
  {
    market_id: 305, epoch_id: 3,
    title: "Will the Fed cut rates at least twice in 2026?",
    description: "Resolves YES if the FOMC cuts the federal funds rate at least 50bps total in calendar year 2026.",
    category: "Finance", status: "Open", market_mode: "Trading", num_outcomes: 2,
    q_values: [71_000_000, 29_000_000], lmsr_b: 50_000_000, exposure: 8_400_000,
    start_time: now - 5 * DAY, settlement_time: now + 200 * DAY, winning_outcome: 255,
  },
  {
    market_id: 306, epoch_id: 3,
    title: "Will the US pass a federal crypto bill in 2026?",
    description: "Resolves YES if a federal cryptocurrency regulatory bill passes both chambers and is signed into law before Jan 1, 2027.",
    category: "Politics", status: "Open", market_mode: "Trading", num_outcomes: 2,
    q_values: [34_000_000, 66_000_000], lmsr_b: 50_000_000, exposure: 4_200_000,
    start_time: now - 3 * DAY, settlement_time: now + 200 * DAY, winning_outcome: 255,
  },
  {
    market_id: 307, epoch_id: 3,
    title: "Manchester City to win Premier League 2025-26?",
    description: "Resolves YES if Manchester City are the Premier League champions at the end of the 2025-26 season.",
    category: "Sports", status: "Suspended", market_mode: "FixedOdds", num_outcomes: 2,
    q_values: [45_000_000, 55_000_000], lmsr_b: 50_000_000, exposure: 3_800_000,
    start_time: now - 14 * DAY, settlement_time: now + 7 * DAY, winning_outcome: 255,
  },
  {
    market_id: 308, epoch_id: 3,
    title: "Will Apple announce Vision Pro 2 at WWDC 2026?",
    description: "Resolves YES if Apple formally announces a second-generation Vision Pro at WWDC in June 2026.",
    category: "Tech", status: "AwaitingResult", market_mode: "Trading", num_outcomes: 2,
    q_values: [39_000_000, 61_000_000], lmsr_b: 50_000_000, exposure: 2_900_000,
    start_time: now - 20 * DAY, settlement_time: now - 2 * DAY, winning_outcome: 255,
  },
  // ── Epoch 2 — settled ──────────────────────────────────────
  {
    market_id: 201, epoch_id: 2,
    title: "Will ETH hit $5,000 before April 2026?",
    description: "Resolved.", category: "Crypto", status: "Settled", market_mode: "Trading", num_outcomes: 2,
    q_values: [45_000_000, 55_000_000], lmsr_b: 50_000_000, exposure: 0,
    start_time: now - 60 * DAY, settlement_time: now - 20 * DAY, winning_outcome: 0,
  },
  {
    market_id: 202, epoch_id: 2,
    title: "Will Trump announce 2028 run before June 2026?",
    description: "Resolved.", category: "Politics", status: "Settled", market_mode: "Trading", num_outcomes: 2,
    q_values: [62_000_000, 38_000_000], lmsr_b: 50_000_000, exposure: 0,
    start_time: now - 55 * DAY, settlement_time: now - 15 * DAY, winning_outcome: 1,
  },
];

// ─── LMSR helpers ─────────────────────────────────────────────────────────────
export function lmsrPrice(q: number[], outcomeIdx: number, b: number): number {
  const sum = q.reduce((acc, qi) => acc + Math.exp(qi / b), 0);
  return Math.exp(q[outcomeIdx] / b) / sum;
}

export function getMarketPrices(market: MarketAccount): number[] {
  const { q_values, lmsr_b, num_outcomes } = market;
  const b = lmsr_b || 50_000_000;
  const qs = q_values.slice(0, num_outcomes);
  const exps = qs.map((q) => Math.exp(q / b));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ─── My Positions ─────────────────────────────────────────────────────────────
export const MY_POSITIONS: MyPosition[] = [
  {
    market_id: 301, epoch_id: 3,
    market_title: "Will Bitcoin close above $120,000 before Dec 31, 2026?",
    category: "Crypto", outcome_id: 0, outcome_label: "YES",
    shares: 250, avg_price: 0.61, current_price: 0.68,
    value: 170, cost: 152.5, pnl: 17.5, pnl_pct: 11.5,
    market_status: "Open", market_mode: "Trading", settlement_time: now + 220 * DAY,
  },
  {
    market_id: 302, epoch_id: 3,
    market_title: "Will Solana reach $1,000 by end of 2026?",
    category: "Crypto", outcome_id: 0, outcome_label: "YES",
    shares: 500, avg_price: 0.40, current_price: 0.43,
    value: 215, cost: 200, pnl: 15, pnl_pct: 7.5,
    market_status: "Open", market_mode: "Trading", settlement_time: now + 220 * DAY,
  },
  {
    market_id: 305, epoch_id: 3,
    market_title: "Will the Fed cut rates at least twice in 2026?",
    category: "Finance", outcome_id: 1, outcome_label: "NO",
    shares: 100, avg_price: 0.35, current_price: 0.29,
    value: 29, cost: 35, pnl: -6, pnl_pct: -17.1,
    market_status: "Open", market_mode: "Trading", settlement_time: now + 200 * DAY,
  },
  {
    market_id: 201, epoch_id: 2,
    market_title: "Will ETH hit $5,000 before April 2026?",
    category: "Crypto", outcome_id: 0, outcome_label: "YES",
    shares: 200, avg_price: 0.42, current_price: 1.0,
    value: 200, cost: 84, pnl: 116, pnl_pct: 138.1,
    market_status: "Settled", market_mode: "Trading", settlement_time: now - 20 * DAY,
  },
  {
    market_id: 202, epoch_id: 2,
    market_title: "Will Trump announce 2028 run before June 2026?",
    category: "Politics", outcome_id: 1, outcome_label: "NO",
    shares: 150, avg_price: 0.55, current_price: 0,
    value: 0, cost: 82.5, pnl: -82.5, pnl_pct: -100,
    market_status: "Settled", market_mode: "Trading", settlement_time: now - 15 * DAY,
  },
];

// ─── Bet Slips ────────────────────────────────────────────────────────────────
export const MY_SLIPS: BetSlipAccount[] = [
  {
    slip_id: 1001,
    creator: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
    legs: [
      { market_id: 303, outcome_id: 0, num_shares: 50, market_title: "Will Argentina win the 2026 FIFA World Cup?", outcome_label: "YES", price: 0.22 },
      { market_id: 304, outcome_id: 1, num_shares: 50, market_title: "Will Brazil win the 2026 FIFA World Cup?", outcome_label: "NO", price: 0.82 },
    ],
    num_legs: 2, total_stake: 20_000_000, combined_odds_fp: 248_000_000,
    house_margin_bps: 250, potential_payout: 115_000_000,
    locked_amount: 115_000_000, exposure_locked: 95_000_000, claimed: false,
  },
  {
    slip_id: 1002,
    creator: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
    legs: [
      { market_id: 307, outcome_id: 0, num_shares: 100, market_title: "Manchester City to win Premier League 2025-26?", outcome_label: "YES", price: 0.45 },
    ],
    num_legs: 1, total_stake: 45_000_000, combined_odds_fp: 222_000_000,
    house_margin_bps: 250, potential_payout: 100_000_000,
    locked_amount: 100_000_000, exposure_locked: 55_000_000, claimed: false,
  },
];

// ─── Limit Orders ─────────────────────────────────────────────────────────────
export const MY_ORDERS: LimitOrderAccount[] = [
  {
    order_id: 5001, creator: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
    market_id: 301, outcome_id: 0, side: "Sell",
    num_shares: 100, filled_shares: 35, price_per_share: 0.74,
    collateral_locked: 0, status: "PartiallyFilled",
    created_at: now - 2 * 3600, expires_at: now + 5 * DAY,
  },
  {
    order_id: 5002, creator: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
    market_id: 302, outcome_id: 0, side: "Sell",
    num_shares: 200, filled_shares: 0, price_per_share: 0.50,
    collateral_locked: 0, status: "Open",
    created_at: now - 1 * 3600, expires_at: now + 7 * DAY,
  },
];

// ─── Public order book ────────────────────────────────────────────────────────
export const ORDER_BOOK_SELLS: LimitOrderAccount[] = [
  { order_id: 4001, creator: "9H1D...qsLC", market_id: 301, outcome_id: 0, side: "Sell", num_shares: 500, filled_shares: 0, price_per_share: 0.70, collateral_locked: 0, status: "Open", created_at: now - 3600, expires_at: now + 3 * DAY },
  { order_id: 4002, creator: "7xKp...wQ2x", market_id: 301, outcome_id: 0, side: "Sell", num_shares: 250, filled_shares: 80, price_per_share: 0.72, collateral_locked: 0, status: "PartiallyFilled", created_at: now - 7200, expires_at: now + 2 * DAY },
  { order_id: 4003, creator: "3mNb...tR9z", market_id: 301, outcome_id: 0, side: "Sell", num_shares: 1000, filled_shares: 0, price_per_share: 0.75, collateral_locked: 0, status: "Open", created_at: now - 1800, expires_at: now + 7 * DAY },
];

export const ORDER_BOOK_BUYS: LimitOrderAccount[] = [
  { order_id: 4010, creator: "Bv4d...kL2p", market_id: 301, outcome_id: 0, side: "Buy", num_shares: 400, filled_shares: 0, price_per_share: 0.65, collateral_locked: 26_000_000, status: "Open", created_at: now - 1200, expires_at: now + 4 * DAY },
  { order_id: 4011, creator: "Fp2x...mN8q", market_id: 301, outcome_id: 0, side: "Buy", num_shares: 200, filled_shares: 50, price_per_share: 0.63, collateral_locked: 9_450_000, status: "PartiallyFilled", created_at: now - 5400, expires_at: now + 2 * DAY },
  { order_id: 4012, creator: "Kq7r...vT4s", market_id: 301, outcome_id: 0, side: "Buy", num_shares: 800, filled_shares: 0, price_per_share: 0.60, collateral_locked: 48_000_000, status: "Open", created_at: now - 900, expires_at: now + 6 * DAY },
];

// ─── LP data ──────────────────────────────────────────────────────────────────
export const MY_PENDING_LIQUIDITY: PendingLiquidityAccount = {
  lp: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
  shares: 450_000, activation_time: now + 2 * DAY, amount_deposited: 500_000_000,
};

export const MY_WITHDRAWAL_REQUEST: WithdrawalRequestAccount = {
  lp: "ALk6ta2LismxQBnbYHiZz34SxvnBBveeX4Y6yTprQyep",
  shares: 200_000, requested_at: now - 4 * 3600,
  cooldown_end: now + 20 * 3600, nav_snapshot: 42_800_000_000,
  share_price_snapshot: 1_050_000_000,
};

// ─── LP per-epoch positions ───────────────────────────────────────────────────
export const MY_LP_EPOCHS: LPEpochPosition[] = [
  {
    epoch_id: 3,
    deposited_sol: 15.0,
    shares_held: 1_250_000,
    current_value_sol: 15.84,
    fees_earned_sol: 0.84,
    pnl_sol: 0.84,
    pnl_pct: 5.6,
    apy: 18.4,
    status: "Active",
    entry_date: now - 12 * DAY,
    exit_date: null,
  },
  {
    epoch_id: 2,
    deposited_sol: 8.0,
    shares_held: 0,
    current_value_sol: 8.31,
    fees_earned_sol: 0.31,
    pnl_sol: 0.31,
    pnl_pct: 3.875,
    apy: 16.1,
    status: "Withdrawn",
    entry_date: now - 42 * DAY,
    exit_date: now - 12 * DAY,
  },
  {
    epoch_id: 1,
    deposited_sol: 5.0,
    shares_held: 0,
    current_value_sol: 5.18,
    fees_earned_sol: 0.18,
    pnl_sol: 0.18,
    pnl_pct: 3.6,
    apy: 14.2,
    status: "Withdrawn",
    entry_date: now - 72 * DAY,
    exit_date: now - 42 * DAY,
  },
];

// ─── P2P Auctions ─────────────────────────────────────────────────────────────
export const SLIP_AUCTIONS: P2PAuction[] = [
  {
    auction_id: 9001,
    slip_id: 1001,
    min_bid_sol: 0.08,
    buy_now_sol: 0.18,
    current_bid_sol: 0.12,
    current_bidder_short: "7xKp…wQ2x",
    ends_at: now + 4 * 3600,
    status: "Active",
    bids: [
      { bidder_short: "7xKp…wQ2x", amount_sol: 0.12, placed_at: now - 20 * 60 },
      { bidder_short: "Bv4d…kL2p", amount_sol: 0.10, placed_at: now - 45 * 60 },
      { bidder_short: "Fp2x…mN8q", amount_sol: 0.08, placed_at: now - 70 * 60 },
    ],
  },
];

// ─── Cumulative P&L history (sparkline data) ──────────────────────────────────
export const PNL_HISTORY: PnLPoint[] = [
  { ts: now - 70 * DAY, cumulative_pnl: 0 },
  { ts: now - 60 * DAY, cumulative_pnl: 8.2 },
  { ts: now - 50 * DAY, cumulative_pnl: 22.4 },
  { ts: now - 42 * DAY, cumulative_pnl: 18.1 },
  { ts: now - 35 * DAY, cumulative_pnl: 31.5 },
  { ts: now - 28 * DAY, cumulative_pnl: 28.0 },
  { ts: now - 20 * DAY, cumulative_pnl: 54.8 },
  { ts: now - 14 * DAY, cumulative_pnl: 62.0 },
  { ts: now - 10 * DAY, cumulative_pnl: 58.5 },
  { ts: now - 7 * DAY,  cumulative_pnl: 66.2 },
  { ts: now - 4 * DAY,  cumulative_pnl: 70.8 },
  { ts: now - 2 * DAY,  cumulative_pnl: 69.1 },
  { ts: now,            cumulative_pnl: 76.5 },
];
