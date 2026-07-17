import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type Connection } from "@solana/web3.js";
import { QUADRATIC_MARKET_IDL, QUADRATIC_MARKET_PROGRAM_ID } from "@/lib/abi";
import type { EpochAccount, MarketAccount } from "@/lib/types";

export type UiMarketStatus = "Open" | "Suspended" | "AwaitingResult" | "Proposed" | "Settled" | "Voided";
export type UiMarketMode = "Trading" | "FixedOdds";
export type UiSlipStatus = "Pending" | "Active" | "Won" | "Lost" | "Cancelled";
export type UiOrderSide = "Buy" | "Sell";
export type UiOrderStatus = "Open" | "PartiallyFilled" | "Filled" | "Cancelled";
export type UiLPEpochStatus = "Active" | "Settled" | "PendingWithdraw" | "Withdrawn";

export interface UiMarketAccount {
  market_id: number;
  epoch_id: number;
  title: string;
  description: string;
  category: string;
  status: UiMarketStatus;
  market_mode: UiMarketMode;
  num_outcomes: number;
  price_points: number[];
  price_scale: number;
  exposure: number;
  start_time: number;
  settlement_time: number;
  winning_outcome: number;
  group_id?: number;
}

export interface UiEpochAccount {
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

export interface UiSlipLeg {
  market_id: number;
  outcome_id: number;
  num_shares: number;
  market_title?: string;
  outcome_label?: string;
  price?: number;
}

export interface UiSlipAccount {
  slip_id: number;
  creator: string;
  legs: UiSlipLeg[];
  num_legs: number;
  total_stake: number;
  total_cost: number;
  combined_odds_fp: number;
  house_margin_bps: number;
  potential_payout: number;
  locked_amount: number;
  status: UiSlipStatus;
  created_at: number;
  cancel_deadline: number;
  claimed: boolean;
}

export interface UiLimitOrderAccount {
  order_id: number;
  creator: string;
  market_id: number;
  outcome_id: number;
  side: UiOrderSide;
  num_shares: number;
  filled_shares: number;
  price_per_share: number;
  collateral_locked: number;
  status: UiOrderStatus;
  created_at: number;
  expires_at: number;
}

export interface UiPendingLiquidityAccount {
  lp: string;
  shares: number;
  activation_time: number;
  amount_deposited: number;
}

export interface UiWithdrawalRequestAccount {
  lp: string;
  shares: number;
  requested_at: number;
  cooldown_end: number;
  nav_snapshot: number;
  share_price_snapshot: number;
}

export interface UiEpochVaultAccount {
  epoch_id: number;
  total_deposits: number;
  total_withdrawals: number;
  total_shares: number;
  num_lps: number;
  created_at: number;
  closed_at: number;
  withdrawals_enabled: boolean;
}

export interface UiEpochLpPositionAccount {
  owner: string;
  epoch_id: number;
  shares: number;
  withdrawn: boolean;
}

export interface UiMarketGroupAccount {
  group_id: number;
  creator: string;
  total_group_exposure: number;
  max_group_exposure: number;
  num_markets: number;
  market_ids: number[];
  event_start_time: number;
  title: string;
  correlation_matrix: number[];
}

const CATEGORY_LABELS = ["Sports", "Crypto", "Finance", "Politics", "Tech", "Other"] as const;
const STATUS_LABELS: UiMarketStatus[] = ["Open", "Suspended", "AwaitingResult", "Proposed", "Settled", "Voided"];

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toBool(value: unknown): boolean {
  return Boolean(value);
}

function asPubkeyString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value && typeof value === "object" && "toBase58" in value && typeof (value as { toBase58: () => string }).toBase58 === "function") {
    return (value as { toBase58: () => string }).toBase58();
  }
  return "";
}

function firstDefined<T>(...values: Array<T | undefined | null>): T | undefined {
  return values.find((value) => value !== undefined && value !== null) as T | undefined;
}

export function getCategoryLabel(category: unknown): string {
  if (typeof category === "string") return category;
  const idx = toNumber(category);
  return CATEGORY_LABELS[idx] ?? "Other";
}

export function getMarketStatusLabel(status: unknown): UiMarketStatus {
  if (typeof status === "string" && STATUS_LABELS.includes(status as UiMarketStatus)) {
    return status as UiMarketStatus;
  }
  return "Open";
}

export function getMarketPrices(market: Pick<UiMarketAccount, "price_points" | "price_scale" | "num_outcomes">): number[] {
  const points = market.price_points.slice(0, market.num_outcomes);
  if (points.length === 0) {
    return [0.5, 0.5];
  }
  const inverse = points.map((pricePoint) => {
    const odds = Math.max(pricePoint, 1);
    return 1 / odds;
  });
  const total = inverse.reduce((sum, value) => sum + value, 0) || 1;
  const normalized = inverse.map((value) => value / total);
  if (normalized.length === 1) return [normalized[0], 1 - normalized[0]];
  return normalized.slice(0, 2);
}

export function getMarketDisplayOdds(market: Pick<UiMarketAccount, "price_points" | "num_outcomes">): [number, number] {
  const first = market.price_points[0] ?? 10_000;
  const second = market.price_points[1] ?? first;
  const yes = Math.max(first, 1);
  const no = Math.max(second, 1);
  return [yes / 100, no / 100];
}

export interface ContractSnapshot {
  epochs: EpochAccount[];
  markets: MarketAccount[];
  marketGroups: UiMarketGroupAccount[];
  slips: UiSlipAccount[];
  limitOrders: UiLimitOrderAccount[];
  pendingLiquidity: UiPendingLiquidityAccount[];
  withdrawalRequests: UiWithdrawalRequestAccount[];
  epochVaults: UiEpochVaultAccount[];
  epochLpPositions: UiEpochLpPositionAccount[];
}

function toUiMarket(market: UiMarketAccount): MarketAccount {
  return market as unknown as MarketAccount;
}

function createReadonlyProgram(connection: Connection) {
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: new PublicKey("11111111111111111111111111111111"),
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    } as any,
    { commitment: "confirmed" }
  );

  return new Program(QUADRATIC_MARKET_IDL as Idl, provider);
}

export async function fetchContractSnapshot(connection: Connection): Promise<ContractSnapshot> {
  const program = createReadonlyProgram(connection);
  const accounts = program.account as any;
  const [
    markets,
    epochs,
    marketGroups,
    slips,
    limitOrders,
    pendingLiquidity,
    withdrawalRequests,
    epochVaults,
    epochLpPositions,
  ] = await Promise.all([
    accounts.market.all(),
    accounts.epoch.all(),
    accounts.marketGroup.all(),
    accounts.slip.all(),
    accounts.limitOrder.all(),
    accounts.pendingLiquidity.all(),
    accounts.withdrawalRequest.all(),
    accounts.epochVault.all(),
    accounts.epochLpPosition.all(),
  ]);

  const marketRows = markets as Array<{ account: UiMarketAccount }>;
  const epochRows = epochs as Array<{ account: UiEpochAccount }>;
  const marketGroupRows = marketGroups as Array<{ account: UiMarketGroupAccount }>;
  const slipRows = slips as Array<{ account: UiSlipAccount }>;
  const limitOrderRows = limitOrders as Array<{ account: UiLimitOrderAccount }>;
  const pendingLiquidityRows = pendingLiquidity as Array<{ account: UiPendingLiquidityAccount }>;
  const withdrawalRequestRows = withdrawalRequests as Array<{ account: UiWithdrawalRequestAccount }>;
  const epochVaultRows = epochVaults as Array<{ account: UiEpochVaultAccount }>;
  const epochLpPositionRows = epochLpPositions as Array<{ account: UiEpochLpPositionAccount }>;

  return {
    markets: sortMarkets(marketRows.map((item, index) => toUiMarket(normalizeMarket(item.account, index)))),
    epochs: sortEpochs(epochRows.map((item, index) => normalizeEpoch(item.account, index))),
    marketGroups: marketGroupRows.map((item) => normalizeMarketGroup(item.account)),
    slips: slipRows.map((item, index) => normalizeSlip(item.account, index)),
    limitOrders: limitOrderRows.map((item, index) => normalizeOrder(item.account, index)),
    pendingLiquidity: pendingLiquidityRows.map((item) => normalizePendingLiquidity(item.account)),
    withdrawalRequests: withdrawalRequestRows.map((item) => normalizeWithdrawalRequest(item.account)),
    epochVaults: epochVaultRows.map((item) => normalizeEpochVault(item.account)),
    epochLpPositions: epochLpPositionRows.map((item) => normalizeEpochLpPosition(item.account)),
  };
}

export function priceFromMarket(market: Pick<UiMarketAccount, "price_points" | "price_scale" | "num_outcomes">, outcomeIndex: number): number {
  const prices = getMarketPrices(market);
  return prices[outcomeIndex] ?? 0.5;
}

export function sortMarkets(markets: MarketAccount[]): MarketAccount[] {
  return [...markets].sort((a, b) => {
    if (a.status !== b.status) {
      const order = ["Open", "Suspended", "AwaitingResult", "Proposed", "Settled", "Voided"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    }
    return b.market_id - a.market_id;
  });
}

export function sortEpochs(epochs: EpochAccount[]): EpochAccount[] {
  return [...epochs].sort((a, b) => b.epoch_id - a.epoch_id);
}

export function normalizeMarket(raw: any, fallbackId = 0): UiMarketAccount {
  const marketId = toNumber(firstDefined(raw?.marketId, raw?.market_id, fallbackId));
  const epochId = toNumber(firstDefined(raw?.epochId, raw?.epoch_id, 0));
  const title = String(firstDefined(raw?.title, "") ?? "");
  const description = String(firstDefined(raw?.description, "") ?? "");
  const category = getCategoryLabel(firstDefined(raw?.category, 0));
  const status = getMarketStatusLabel(firstDefined(raw?.status, raw?.market_status));
  const typeName = typeof raw?.marketType === "string"
    ? raw.marketType
    : raw?.marketType
      ? Object.keys(raw.marketType)[0]
      : undefined;
  const marketMode: UiMarketMode = String(typeName ?? "").toLowerCase().includes("trading")
    ? "Trading"
    : "FixedOdds";
  const numOutcomes = toNumber(firstDefined(raw?.numOutcomes, raw?.num_outcomes, 2)) || 2;
  const odds = Array.isArray(raw?.odds) ? raw.odds.map(toNumber) : [];
  const pricePoints = odds.length > 0 ? odds.slice(0, numOutcomes) : [10_000, 10_000];
  const priceScale = pricePoints.reduce((max: number, value: number) => Math.max(max, value), 10_000);
  const groupId = raw?.groupId ?? raw?.group_id;
  const winningOutcome = toNumber(firstDefined(raw?.winningOutcome, raw?.winning_outcome, 255));

  return {
    market_id: marketId,
    epoch_id: epochId,
    title,
    description,
    category,
    status,
    market_mode: marketMode,
    num_outcomes: numOutcomes,
    price_points: pricePoints,
    price_scale: priceScale,
    exposure: toNumber(firstDefined(raw?.exposure, 0)),
    start_time: toNumber(firstDefined(raw?.startTime, raw?.start_time, 0)),
    settlement_time: toNumber(firstDefined(raw?.settlementTime, raw?.settlement_time, 0)),
    winning_outcome: winningOutcome,
    group_id: groupId !== undefined && groupId !== null ? toNumber(groupId) : undefined,
  };
}

export function normalizeEpoch(raw: any, fallbackId = 0): UiEpochAccount {
  return {
    epoch_id: toNumber(firstDefined(raw?.epochId, raw?.epoch_id, fallbackId)),
    start_time: toNumber(firstDefined(raw?.startTime, raw?.start_time, 0)),
    end_time: toNumber(firstDefined(raw?.endTime, raw?.end_time, 0)),
    total_liquidity_added: toNumber(firstDefined(raw?.totalLiquidityAdded, raw?.total_liquidity_added, 0)),
    total_liquidity_removed: toNumber(firstDefined(raw?.totalLiquidityRemoved, raw?.total_liquidity_removed, 0)),
    num_markets: toNumber(firstDefined(raw?.numMarkets, raw?.num_markets, 0)),
    num_settled_markets: toNumber(firstDefined(raw?.numSettledMarkets, raw?.num_settled_markets, 0)),
    all_markets_settled: toBool(firstDefined(raw?.allMarketsSettled, raw?.all_markets_settled, false)),
    withdrawals_enabled: toBool(firstDefined(raw?.withdrawalsEnabled, raw?.withdrawals_enabled, false)),
    lp_shares_at_close: toNumber(firstDefined(raw?.lpSharesAtClose, raw?.lp_shares_at_close, 0)),
  };
}

export function normalizeSlip(raw: any, fallbackId = 0): UiSlipAccount {
  const legs = Array.isArray(raw?.legMarketIds)
    ? raw.legMarketIds
        .map((marketId: unknown, index: number) => ({
          market_id: toNumber(marketId),
          outcome_id: toNumber(raw?.legOutcomeIds?.[index] ?? 0),
          num_shares: 0,
          market_title: undefined,
          outcome_label: undefined,
          price: undefined,
        }))
        .filter((leg: UiSlipLeg) => leg.market_id > 0)
    : [];

  return {
    slip_id: toNumber(firstDefined(raw?.slipId, raw?.slip_id, fallbackId)),
    creator: asPubkeyString(firstDefined(raw?.owner, raw?.creator)),
    legs,
    num_legs: toNumber(firstDefined(raw?.numLegs, raw?.num_legs, legs.length)),
    total_stake: toNumber(firstDefined(raw?.totalStake, raw?.total_stake, 0)),
    total_cost: toNumber(firstDefined(raw?.totalCost, raw?.total_cost, 0)),
    combined_odds_fp: toNumber(firstDefined(raw?.combinedOddsFp, raw?.combined_odds_fp, 0)),
    house_margin_bps: toNumber(firstDefined(raw?.houseMarginBps, raw?.house_margin_bps, 0)),
    potential_payout: toNumber(firstDefined(raw?.potentialPayout, raw?.potential_payout, 0)),
    locked_amount: toNumber(firstDefined(raw?.lockedAmount, raw?.locked_amount, 0)),
    status: String(firstDefined(raw?.status, "Pending")) as UiSlipStatus,
    created_at: toNumber(firstDefined(raw?.createdAt, raw?.created_at, 0)),
    cancel_deadline: toNumber(firstDefined(raw?.cancelDeadline, raw?.cancel_deadline, 0)),
    claimed: toBool(firstDefined(raw?.claimed, false)),
  };
}

export function normalizeOrder(raw: any, fallbackId = 0): UiLimitOrderAccount {
  return {
    order_id: toNumber(firstDefined(raw?.orderId, raw?.order_id, fallbackId)),
    creator: asPubkeyString(firstDefined(raw?.creator)),
    market_id: toNumber(firstDefined(raw?.marketId, raw?.market_id, 0)),
    outcome_id: toNumber(firstDefined(raw?.outcomeId, raw?.outcome_id, 0)),
    side: String(firstDefined(raw?.side, "Buy")) as UiOrderSide,
    num_shares: toNumber(firstDefined(raw?.numShares, raw?.num_shares, 0)),
    filled_shares: toNumber(firstDefined(raw?.filledShares, raw?.filled_shares, 0)),
    price_per_share: toNumber(firstDefined(raw?.pricePerShare, raw?.price_per_share, 0)),
    collateral_locked: toNumber(firstDefined(raw?.collateralLocked, raw?.collateral_locked, 0)),
    status: String(firstDefined(raw?.status, "Open")) as UiOrderStatus,
    created_at: toNumber(firstDefined(raw?.createdAt, raw?.created_at, 0)),
    expires_at: toNumber(firstDefined(raw?.expiresAt, raw?.expires_at, 0)),
  };
}

export function normalizePendingLiquidity(raw: any): UiPendingLiquidityAccount {
  return {
    lp: asPubkeyString(firstDefined(raw?.lp)),
    shares: toNumber(firstDefined(raw?.shares, 0)),
    activation_time: toNumber(firstDefined(raw?.activationTime, raw?.activation_time, 0)),
    amount_deposited: toNumber(firstDefined(raw?.amountDeposited, raw?.amount_deposited, 0)),
  };
}

export function normalizeWithdrawalRequest(raw: any): UiWithdrawalRequestAccount {
  return {
    lp: asPubkeyString(firstDefined(raw?.lp)),
    shares: toNumber(firstDefined(raw?.shares, 0)),
    requested_at: toNumber(firstDefined(raw?.requestedAt, raw?.requested_at, 0)),
    cooldown_end: toNumber(firstDefined(raw?.cooldownEnd, raw?.cooldown_end, 0)),
    nav_snapshot: toNumber(firstDefined(raw?.navSnapshot, raw?.nav_snapshot, 0)),
    share_price_snapshot: toNumber(firstDefined(raw?.sharePriceSnapshot, raw?.share_price_snapshot, 0)),
  };
}

export function normalizeEpochVault(raw: any): UiEpochVaultAccount {
  return {
    epoch_id: toNumber(firstDefined(raw?.epochId, raw?.epoch_id, 0)),
    total_deposits: toNumber(firstDefined(raw?.totalDeposits, raw?.total_deposits, 0)),
    total_withdrawals: toNumber(firstDefined(raw?.totalWithdrawals, raw?.total_withdrawals, 0)),
    total_shares: toNumber(firstDefined(raw?.totalShares, raw?.total_shares, 0)),
    num_lps: toNumber(firstDefined(raw?.numLps, raw?.num_lps, 0)),
    created_at: toNumber(firstDefined(raw?.createdAt, raw?.created_at, 0)),
    closed_at: toNumber(firstDefined(raw?.closedAt, raw?.closed_at, 0)),
    withdrawals_enabled: toBool(firstDefined(raw?.withdrawalsEnabled, raw?.withdrawals_enabled, false)),
  };
}

export function normalizeEpochLpPosition(raw: any): UiEpochLpPositionAccount {
  return {
    owner: asPubkeyString(firstDefined(raw?.owner)),
    epoch_id: toNumber(firstDefined(raw?.epochId, raw?.epoch_id, 0)),
    shares: toNumber(firstDefined(raw?.shares, 0)),
    withdrawn: toBool(firstDefined(raw?.withdrawn, false)),
  };
}

export function normalizeMarketGroup(raw: any): UiMarketGroupAccount {
  return {
    group_id: toNumber(firstDefined(raw?.groupId, raw?.group_id, 0)),
    creator: asPubkeyString(firstDefined(raw?.creator)),
    total_group_exposure: toNumber(firstDefined(raw?.totalGroupExposure, raw?.total_group_exposure, 0)),
    max_group_exposure: toNumber(firstDefined(raw?.maxGroupExposure, raw?.max_group_exposure, 0)),
    num_markets: toNumber(firstDefined(raw?.numMarkets, raw?.num_markets, 0)),
    market_ids: Array.isArray(raw?.marketIds) ? raw.marketIds.map(toNumber) : [],
    event_start_time: toNumber(firstDefined(raw?.eventStartTime, raw?.event_start_time, 0)),
    title: String(firstDefined(raw?.title, "")),
    correlation_matrix: Array.isArray(raw?.correlationMatrix?.correlations)
      ? raw.correlationMatrix.correlations.map(toNumber)
      : [],
  };
}

export function sortMarketsByExposure(markets: UiMarketAccount[]): UiMarketAccount[] {
  return [...markets].sort((a, b) => b.exposure - a.exposure);
}

export function getMarketPriceSummary(market: Pick<UiMarketAccount, "price_points" | "price_scale" | "num_outcomes">): {
  yes: number;
  no: number;
} {
  const [yes, no] = getMarketPrices(market);
  return { yes, no };
}

export function getMarketOutcomeLabel(market: UiMarketAccount, outcomeId: number): string {
  if (market.num_outcomes === 3) {
    return ["HOME", "DRAW", "AWAY"][outcomeId] ?? `OUTCOME ${outcomeId + 1}`;
  }
  return outcomeId === 0 ? "YES" : "NO";
}

export function getMarketDisplayMode(market: UiMarketAccount): string {
  return market.market_mode === "Trading" ? "Trading" : "Fixed Odds";
}

export { QUADRATIC_MARKET_IDL as contractAbi, QUADRATIC_MARKET_PROGRAM_ID as contractAddress };
