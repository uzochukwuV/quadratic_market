import { useQuery } from "@tanstack/react-query";

export const AGENT_FEED_URL = (import.meta.env.VITE_AGENT_FEED_URL as string) || "";

export type AgentFeedType = "match_read" | "odds_shift" | "score_update" | "signal";

export interface AgentFeedItem {
  id: string;
  type: AgentFeedType;
  fixtureId: number | null;
  homeTeam: string;
  awayTeam: string;
  title: string;
  body: string;
  source: string;
  confidence: number | null;
  createdAt: number;
  tags: string[];
}

function asSeconds(value: unknown): number {
  if (typeof value === "number") return value > 10 ** 12 ? Math.floor(value / 1000) : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10 ** 12 ? Math.floor(numeric / 1000) : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function asType(value: unknown): AgentFeedType {
  if (value === "odds_shift" || value === "score_update" || value === "signal") return value;
  return "match_read";
}

function normalizeFeedItem(raw: any, index: number): AgentFeedItem {
  return {
    id: String(raw.id ?? raw.feed_id ?? `${raw.fixture_id ?? raw.fixtureId ?? "feed"}-${index}`),
    type: asType(raw.type ?? raw.kind),
    fixtureId: Number(raw.fixture_id ?? raw.fixtureId) || null,
    homeTeam: String(raw.home_team ?? raw.homeTeam ?? raw.home ?? "Home"),
    awayTeam: String(raw.away_team ?? raw.awayTeam ?? raw.away ?? "Away"),
    title: String(raw.title ?? raw.headline ?? "AI match read"),
    body: String(raw.body ?? raw.text ?? raw.message ?? raw.analysis ?? ""),
    source: String(raw.source ?? "TxLINE AI Pundit"),
    confidence:
      typeof raw.confidence === "number"
        ? raw.confidence
        : typeof raw.signal_confidence === "number"
          ? raw.signal_confidence
          : null,
    createdAt: asSeconds(raw.created_at ?? raw.createdAt ?? raw.ts ?? raw.timestamp),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
}

export async function fetchAgentFeeds(): Promise<AgentFeedItem[]> {
  if (!AGENT_FEED_URL) return [];

  const response = await fetch(AGENT_FEED_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Agent feed error ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.feeds)
      ? payload.feeds
      : Array.isArray(payload.items)
        ? payload.items
        : [];

  return rows
    .map((row: unknown, index: number) => normalizeFeedItem(row, index))
    .sort((a: AgentFeedItem, b: AgentFeedItem) => b.createdAt - a.createdAt);
}

export function useAgentFeeds() {
  return useQuery({
    queryKey: ["agent-feeds", AGENT_FEED_URL],
    queryFn: fetchAgentFeeds,
    enabled: Boolean(AGENT_FEED_URL),
    staleTime: 15_000,
    refetchInterval: AGENT_FEED_URL ? 20_000 : false,
  });
}
