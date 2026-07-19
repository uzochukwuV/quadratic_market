import { useQuery, useMutation } from "@tanstack/react-query";

// Bot API config — override via env vars
export const BOT_API_URL =
  (import.meta.env.VITE_BOT_API_URL as string) ||
  "https://d17eznfv4qokvh.cloudfront.net";

export const BOT_API_KEY =
  (import.meta.env.VITE_BOT_API_KEY as string) || "";

// USDC base mint address
export const BASE_MINT_ADDRESS =
  (import.meta.env.VITE_BASE_MINT as string) ||
  "8yqhLuiQRnvuU1RjDPM4kcRCcD1D5wPRfWdpG6dom3Vk";

// 100 USDC as default faucet amount (6 decimals)
export const FAUCET_AMOUNT = 100_000_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotMarket {
  market_id: number;
  fixture_id: number;
  group_id: number | null;
  epoch_id: number;
  title: string;
  description: string;
  status: string;        // "open" | "suspended" | "settled" | "voided" | "closed"
  market_type: string;   // "1x2" | "over_under" | "gg_ng"
  category: number;
  num_outcomes: number;
  start_time: number;    // unix seconds
  odds: number[];        // basis points — 20000 = 2.00×
  winning_outcome: number;
  settlement_time: number;
  settled_in_epoch: boolean;
  stage: string | null;
}

export interface BotVault {
  exists: boolean;
  total_deposits: number;
  total_withdrawals: number;
  total_shares: number;
  num_lps: number;
  withdrawals_enabled: boolean;
}

export interface BotEpoch {
  epoch_id: number;
  exists: boolean;
  start_time: number | null;
  end_time: number | null;
  num_markets: number;
  num_settled_markets: number;
  all_markets_settled: boolean;
  withdrawals_enabled: boolean;
  vault: BotVault;
  markets: BotMarket[];
}

export interface BotMarketsResponse {
  count: number;
  epoch_count: number;
  epochs: BotEpoch[];
}

export interface MintBaseResponse {
  recipient: string;
  recipient_ata: string;
  amount: number;
  signature: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function botHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (BOT_API_KEY) h["X-API-Key"] = BOT_API_KEY;
  return h;
}

/** Flatten all markets from all epochs. */
export function flattenMarkets(data: BotMarketsResponse): BotMarket[] {
  return data.epochs.flatMap((e) => e.markets);
}

/**
 * Group markets by their fixture/group.
 * Returns an array of fixture groups, each containing:
 *   - groupKey: string (group_id or fixture_id)
 *   - title: match title with suffix stripped ("Team A vs Team B")
 *   - markets: all BotMarket records for this fixture
 *   - homeTeam / awayTeam: parsed from first market title
 *   - startTime: earliest start_time
 *   - status: "open" if any market is open
 *   - marketTypes: deduplicated list of market_type strings
 */
export interface FixtureGroup {
  groupKey: string;
  homeTeam: string;
  awayTeam: string;
  startTime: number;
  status: string;
  stage: string | null;
  marketTypes: string[];
  markets: BotMarket[];
  primaryMarketId: number;  // first 1x2 market_id, or first market
}

/** Canonical market type key — normalise legacy names to current names */
export function normaliseMType(raw: string): string {
  if (raw === "onextwo") return "1x2";
  if (raw === "overunder") return "over_under";
  if (raw === "goalnogoal") return "gg_ng";
  return raw;
}

/**
 * Extract "Team A vs Team B" from any of:
 *   "1X2: Team A vs Team B"        (colon-prefix format, real data)
 *   "Team A vs Team B - 1X2"       (suffix format, API docs sample)
 *   "O/U 2.5: Team A vs Team B"    (colon with extra detail)
 */
function extractMatchTitle(title: string): string {
  if (title.includes(": ")) {
    // "1X2: Team A vs Team B" → "Team A vs Team B"
    return title.slice(title.indexOf(": ") + 2);
  }
  if (title.includes(" - ")) {
    // "Team A vs Team B - 1X2" → "Team A vs Team B"
    return title.slice(0, title.lastIndexOf(" - "));
  }
  return title;
}

export function groupMarketsByFixture(markets: BotMarket[]): FixtureGroup[] {
  // Always group by fixture_id — group_id is unreliable in real data
  const map = new Map<number, BotMarket[]>();
  for (const m of markets) {
    const key = m.fixture_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }

  const groups: FixtureGroup[] = [];

  for (const [fixtureId, mList] of map.entries()) {
    // Deduplicate by normalised market_type — when a fixture has duplicate
    // market sets (same type appearing multiple times), keep the lowest market_id
    // (oldest / most likely canonical).
    const byType = new Map<string, BotMarket>();
    for (const m of mList) {
      const mtype = normaliseMType(m.market_type);
      const existing = byType.get(mtype);
      if (!existing || m.market_id < existing.market_id) {
        byType.set(mtype, m);
      }
    }
    const deduped = [...byType.values()];

    // Parse match title from any market (prefer 1x2 / onextwo)
    const titleSource =
      deduped.find((m) => normaliseMType(m.market_type) === "1x2") ??
      deduped[0];
    const matchTitle = extractMatchTitle(titleSource.title);
    const [homeTeam = matchTitle, awayTeam = ""] = matchTitle.split(" vs ");

    const startTime = Math.min(...deduped.map((m) => m.start_time));
    const status = deduped.some((m) => m.status === "open") ? "open" : deduped[0].status;
    const stage = deduped.find((m) => m.stage)?.stage ?? null;
    const marketTypes = [...byType.keys()]; // already normalised

    const primary =
      deduped.find((m) => normaliseMType(m.market_type) === "1x2") ??
      deduped[0];

    groups.push({
      groupKey: String(fixtureId),
      homeTeam,
      awayTeam,
      startTime,
      status,
      stage,
      marketTypes,
      markets: deduped,
      primaryMarketId: primary.market_id,
    });
  }

  // Sort: open first, then by start_time asc
  groups.sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (b.status === "open" && a.status !== "open") return 1;
    return a.startTime - b.startTime;
  });

  return groups;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function fetchMarketsByEpoch(): Promise<BotMarketsResponse> {
  const res = await fetch(`${BOT_API_URL}/api/markets/by-epoch`, {
    headers: botHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Bot API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<BotMarketsResponse>;
}

export async function mintBase(
  recipient: string,
  amount = FAUCET_AMOUNT
): Promise<MintBaseResponse> {
  const res = await fetch(`${BOT_API_URL}/api/mint-base`, {
    method: "POST",
    headers: botHeaders(),
    body: JSON.stringify({ recipient, amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((body as any).detail ?? "Mint failed");
  }
  return res.json() as Promise<MintBaseResponse>;
}

// ─── React Query hooks ───────────────────────────────────────────────────────

export const MARKETS_BY_EPOCH_KEY = ["bot-api", "markets-by-epoch"];

export function useMarketsByEpoch() {
  return useQuery({
    queryKey: MARKETS_BY_EPOCH_KEY,
    queryFn: fetchMarketsByEpoch,
    staleTime: 30_000,   // 30 s — markets don't change that often
    refetchInterval: 60_000, // background refresh every 60 s
  });
}

export function useMintBase() {
  return useMutation({
    mutationFn: ({ recipient, amount }: { recipient: string; amount?: number }) =>
      mintBase(recipient, amount),
  });
}
