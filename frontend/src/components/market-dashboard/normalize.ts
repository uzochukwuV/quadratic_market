import type { Fixture, MarketKey, Outcome, Status } from "./types";

type ProgramAccount<T = Record<string, unknown>> = {
  publicKey?: { toBase58: () => string } | string;
  account: T;
};

const MARKET_LABELS: Record<MarketKey, string> = {
  match_result: "1X2",
  total_goals: "O/U 2.5",
  gg_ng: "GG/NG",
};

function toStringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && "toString" in value) return String(value);
  return fallback;
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function enumKey(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)[0] ?? "";
  return "";
}

function marketKeyFromAccount(account: Record<string, unknown>): MarketKey {
  const key = enumKey(account.marketType).toLowerCase();
  if (key === "overunder" || key === "over_under") return "total_goals";
  if (key === "goalnogoal" || key === "goal_no_goal") return "gg_ng";
  return "match_result";
}

function statusFromAccount(account: Record<string, unknown>): Status {
  const startTime = toNumber(account.startTime);
  const started = startTime > 0 && startTime * 1000 <= Date.now();
  if (!started) return "prematch";
  return "live";
}

function formatStart(account: Record<string, unknown>) {
  const startTime = toNumber(account.startTime);
  if (!startTime) return "--:--";
  return new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startTime * 1000));
}

function accountAddress(account: ProgramAccount) {
  if (!account.publicKey) return "";
  if (typeof account.publicKey === "string") return account.publicKey;
  return account.publicKey.toBase58();
}

function fixtureKey(account: Record<string, unknown>) {
  const title = stripMarketPrefix(String(account.title ?? ""));
  const teams = parseTeams(title);
  if (teams) {
    return `match-${teams.home.toLowerCase()}-${teams.away.toLowerCase()}-${toStringValue(account.startTime)}`;
  }

  const txlineFixtureId = account.txlineFixtureId == null ? "" : toStringValue(account.txlineFixtureId);
  if (txlineFixtureId) return `txline-${txlineFixtureId}`;

  const groupId = account.groupId == null ? "" : toStringValue(account.groupId);
  if (groupId) return `group-${groupId}`;

  return `market-${toStringValue(account.marketId)}`;
}

function stripMarketPrefix(title: string) {
  return title.replace(/^(1x2|o\/u\s*2\.5|gg\/ng)\s*:\s*/i, "").trim();
}

function parseTeams(title: string) {
  const cleaned = stripMarketPrefix(title).trim();
  const separators = [" vs ", " v ", " - ", " @ "];
  for (const separator of separators) {
    const [home, away, ...rest] = cleaned.split(separator);
    if (home && away && rest.length === 0) return { home: home.trim(), away: away.trim() };
  }
  return cleaned ? { home: cleaned, away: "Market" } : null;
}

function outcomeMeta(marketKey: MarketKey, index: number, home: string, away: string) {
  if (marketKey === "match_result") {
    const codes = ["1", "X", "2"];
    const labels = [home, "Draw", away];
    return { code: codes[index] ?? `${index + 1}`, label: labels[index] ?? `Outcome ${index + 1}` };
  }

  if (marketKey === "total_goals") {
    const codes = ["O2.5", "U2.5"];
    const labels = ["Over 2.5", "Under 2.5"];
    return { code: codes[index] ?? `${index + 1}`, label: labels[index] ?? `Outcome ${index + 1}` };
  }

  const codes = ["GG", "NG"];
  const labels = ["Both teams score", "No goal"];
  return { code: codes[index] ?? `${index + 1}`, label: labels[index] ?? `Outcome ${index + 1}` };
}

function buildOutcomes(market: ProgramAccount, home: string, away: string): Outcome[] {
  const account = market.account as Record<string, unknown>;
  const marketKey = marketKeyFromAccount(account);
  const marketId = toStringValue(account.marketId);
  const numOutcomes = toNumber(account.numOutcomes);
  const odds = Array.isArray(account.odds) ? account.odds : [];

  return odds.slice(0, numOutcomes).map((rawOdds, index) => {
    const meta = outcomeMeta(marketKey, index, home, away);
    const decimalOdds = toNumber(rawOdds) / 10000;
    return {
      id: `${marketId}-${index}`,
      marketId,
      marketAccount: accountAddress(market),
      outcomeId: index,
      marketKey,
      code: meta.code,
      label: meta.label,
      odds: decimalOdds > 0 ? decimalOdds : 1,
      trend: "flat",
    };
  });
}

function marketRank(market: ProgramAccount) {
  const account = market.account as Record<string, unknown>;
  const status = enumKey(account.status).toLowerCase();
  const statusRank = status === "open" ? 2 : status === "suspended" ? 1 : 0;
  return statusRank * 1_000_000_000 + toNumber(account.marketId);
}

function uniqueMarketsByType(markets: ProgramAccount[]) {
  const byType = new Map<MarketKey, ProgramAccount>();

  for (const market of markets) {
    const key = marketKeyFromAccount(market.account as Record<string, unknown>);
    const current = byType.get(key);
    if (!current || marketRank(market) > marketRank(current)) {
      byType.set(key, market);
    }
  }

  return (["match_result", "total_goals", "gg_ng"] as MarketKey[])
    .map((key) => byType.get(key))
    .filter((market): market is ProgramAccount => Boolean(market));
}

export function normalizeMarkets(markets: ProgramAccount[]): Fixture[] {
  console.log("[markets] normalizeMarkets:start", { inputCount: markets.length });
  const grouped = new Map<string, ProgramAccount[]>();

  for (const market of markets) {
    const key = fixtureKey(market.account as Record<string, unknown>);
    grouped.set(key, [...(grouped.get(key) ?? []), market]);
  }

  const fixtures = [...grouped.entries()].map(([id, group]) => {
    const uniqueMarkets = uniqueMarketsByType(group);
    const first = uniqueMarkets[0]?.account as Record<string, unknown>;
    const teams = parseTeams(String(first.title ?? "")) ?? { home: "Market", away: toStringValue(first.marketId) };
    const code = toStringValue(first.txlineFixtureId ?? first.groupId ?? first.marketId, id.replace(/\D/g, "").slice(-5) || "chain");
    const outcomes = uniqueMarkets.flatMap((market) => buildOutcomes(market, teams.home, teams.away));
    const start = formatStart(first);
    const status = statusFromAccount(first);
    const exposure = uniqueMarkets.reduce((total, market) => total + toNumber((market.account as Record<string, unknown>).exposure), 0);

    return {
      id,
      code,
      start,
      minute: status === "live" ? start : undefined,
      status,
      country: "On-chain",
      league: "Quadratic Markets",
      home: teams.home,
      away: teams.away,
      liquidity: `N${(exposure / 1_000_000).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`,
      moreMarkets: Math.max(0, uniqueMarkets.length - 3),
      source: "chain" as const,
      outcomes,
    };
  }).sort((a, b) => a.start.localeCompare(b.start));

  console.log("[markets] normalizeMarkets:success", {
    fixtureCount: fixtures.length,
    sample: fixtures.slice(0, 5).map((fixture) => ({
      id: fixture.id,
      home: fixture.home,
      away: fixture.away,
      status: fixture.status,
      outcomes: fixture.outcomes.length,
    })),
  });

  return fixtures;
}

export function marketName(key: MarketKey) {
  return MARKET_LABELS[key];
}
