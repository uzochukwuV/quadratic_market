// ─── Mirrors the on-chain Rust structs exactly ─────────────────────────────

export type MarketStatus =
  | "Open"
  | "Suspended"
  | "AwaitingResult"
  | "Proposed"
  | "Settled"
  | "Voided";

export type MarketMode = "FixedOdds" | "Trading";

export type OrderSide = "Buy" | "Sell";
export type OrderStatus = "Open" | "PartiallyFilled" | "Filled" | "Cancelled";

export interface EpochAccount {
  epoch_id: number;
  start_time: number;
  end_time: number;
  total_liquidity_added: number;
  total_liquidity_removed: number;
  num_markets: number;
  num_settled_markets: number;
  all_markets_settled: boolean;
  withdrawals_enabled: boolean;
  lp_shares_at_close: number;
}

export interface GlobalConfigAccount {
  admin: string;
  paused: boolean;
  oracle_pubkey: string;
  max_market_exposure: number;
  locked_payouts: number;
  total_lp_supply: number;
  lp_mint: string;
  base_mint: string;
  treasury: string;
  treasury_bump: number;
  next_market_id: number;
  challenge_window_seconds: number;
  settlement_deadline_seconds: number;
  min_first_liquidity: number;
  next_slip_id: number;
  current_epoch: number;
  epoch_duration_seconds: number;
  withdrawal_cooldown_seconds: number;
  max_single_bet: number;
  min_odds_bps: number;
  max_odds_bps: number;
  house_fee_bps: number;
  operators: string[];
  num_operators: number;
  bump: number;
  next_order_id: number;
  order_collateral_locked: number;
  epoch_paused: boolean;
  next_epoch_start: number;
}

export interface MarketAccount {
  market_id: number;
  epoch_id: number;
  title: string;
  description: string;
  category: string;
  status: MarketStatus;
  market_mode: MarketMode;
  num_outcomes: number;
  price_points: number[];
  price_scale: number;
  exposure: number;
  start_time: number;
  settlement_time: number;
  winning_outcome: number;
  group_id?: number;
}

export interface MarketGroupAccount {
  group_id: number;
  title: string;
  description: string;
  category: string;
  event_start_time: number;
  max_group_exposure: number;
  total_group_exposure: number;
  num_markets: number;
  market_ids: number[];
  correlation_matrix: number[][];
}

export interface SlipAccount {
  slip_id: number;
  owner: string;
  epoch_id: number;
  num_legs: number;
  leg_market_ids: number[];
  leg_outcome_ids: number[];
  legs_bought_mask: number;
  legs_settled_mask: number;
  legs_won_mask: number;
  total_stake: number;
  total_cost: number;
  potential_payout: number;
  locked_amount: number;
  status: string;
  created_at: number;
  cancel_deadline: number;
  claimed: boolean;
}

export interface SlipLeg {
  market_id: number;
  outcome_id: number;
  num_shares: number;
  market_title?: string;
  outcome_label?: string;
  price?: number;
}

export interface BetSlipAccount {
  slip_id: number;
  creator: string;
  legs: SlipLeg[];
  num_legs: number;
  total_stake: number;
  combined_odds_fp: number;
  house_margin_bps: number;
  potential_payout: number;
  locked_amount: number;
  exposure_locked: number;
  claimed: boolean;
}

export interface LimitOrderAccount {
  order_id: number;
  creator: string;
  market_id: number;
  outcome_id: number;
  side: OrderSide;
  num_shares: number;
  filled_shares: number;
  price_per_share: number;
  collateral_locked: number;
  status: OrderStatus;
  created_at: number;
  expires_at: number;
}

export interface PendingLiquidityAccount {
  lp: string;
  shares: number;
  activation_time: number;
  amount_deposited: number;
}

export interface WithdrawalRequestAccount {
  lp: string;
  shares: number;
  requested_at: number;
  cooldown_end: number;
  nav_snapshot: number;
  share_price_snapshot: number;
}

export interface MyPosition {
  market_id: number;
  epoch_id: number;
  market_title: string;
  category: string;
  outcome_id: number;
  outcome_label: string;
  shares: number;
  avg_price: number;
  current_price: number;
  value: number;
  cost: number;
  pnl: number;
  pnl_pct: number;
  market_status: MarketStatus;
  market_mode: MarketMode;
  settlement_time: number;
}

export interface BetSlipCartItem {
  market_id: number;
  market_title: string;
  outcome_id: number;
  outcome_label: string;
  implied_odds: number;
  stake: number;
}

// ─── LP per-epoch position (UI) ─────────────────────────────────────────────
export type LPEpochStatus = "Active" | "Settled" | "PendingWithdraw" | "Withdrawn";

export interface LPEpochPosition {
  epoch_id: number;
  deposited_sol: number;
  shares_held: number;
  current_value_sol: number;
  fees_earned_sol: number;
  pnl_sol: number;
  pnl_pct: number;
  apy: number;
  status: LPEpochStatus;
  entry_date: number;
  exit_date: number | null;
}

// ─── P2P Auction ─────────────────────────────────────────────────────────────
export interface AuctionBid {
  bidder_short: string;
  amount_sol: number;
  placed_at: number;
}

export type AuctionStatus = "Active" | "Sold" | "Expired";

export interface P2PAuction {
  auction_id: number;
  slip_id: number;
  min_bid_sol: number;
  buy_now_sol: number | null;
  current_bid_sol: number | null;
  current_bidder_short: string | null;
  ends_at: number;
  status: AuctionStatus;
  bids: AuctionBid[];
}

// ─── Analytics summary ───────────────────────────────────────────────────────
export interface TradingStat {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "amber" | "blue" | "default";
}

export interface PnLPoint {
  ts: number;
  cumulative_pnl: number;
}
