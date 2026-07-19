import { Link, useLocation } from "wouter";
import { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  BookMarked,
  Flame,
  LayoutGrid,
  Loader2,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  flattenMarkets,
  groupMarketsByFixture,
  normaliseMType,
  useMarketsByEpoch,
  type FixtureGroup,
} from "@/lib/bot-api";
import { bpsToOdds } from "@/lib/solana-config";
import { useAgentFeeds, type AgentFeedItem, type AgentFeedType } from "@/lib/agent-feed";

type Filter = "all" | "live" | "signals";

const TYPE_STYLE: Record<AgentFeedType, string> = {
  match_read: "border-primary/30 text-primary bg-primary/10",
  odds_shift: "border-accent/40 text-accent bg-accent/10",
  score_update: "border-success/40 text-success bg-success/10",
  signal: "border-yellow-400/40 text-yellow-300 bg-yellow-400/10",
};

function formatTime(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(ts * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
}

function labelForType(type: AgentFeedType): string {
  if (type === "odds_shift") return "Odds shift";
  if (type === "score_update") return "Score";
  if (type === "signal") return "Signal";
  return "Match read";
}

function bestOneXTwo(group: FixtureGroup): string {
  const market = group.markets.find((item) => normaliseMType(item.market_type) === "1x2");
  if (!market || market.odds.length < 3 || market.odds.some((odd) => odd < 10000)) {
    return "The agent is waiting for a cleaner 1X2 price before calling the pressure point.";
  }

  const labels = [group.homeTeam, "Draw", group.awayTeam];
  const prices = market.odds.slice(0, 3).map((odd, index) => ({
    label: labels[index],
    odds: bpsToOdds(odd),
    probability: 1 / bpsToOdds(odd),
  }));
  prices.sort((a, b) => b.probability - a.probability);
  const leader = prices[0];

  return `${leader.label} is carrying the strongest market signal at ${leader.odds.toFixed(2)}x. The read is still live, so the next TxLINE odds move matters more than the current snapshot.`;
}

function derivedFeeds(groups: FixtureGroup[]): AgentFeedItem[] {
  const now = Math.floor(Date.now() / 1000);
  return groups.slice(0, 8).flatMap((group, index) => {
    const marketCount = group.marketTypes.length;
    const base = {
      fixtureId: Number(group.groupKey) || null,
      homeTeam: group.homeTeam,
      awayTeam: group.awayTeam,
      source: "TxLINE AI Pundit",
      confidence: group.status === "open" ? 0.62 : 0.52,
    };

    return [
      {
        ...base,
        id: `${group.groupKey}-read`,
        type: "match_read" as const,
        title: `${group.homeTeam} vs ${group.awayTeam}: pre-match read`,
        body: bestOneXTwo(group),
        createdAt: now - index * 180,
        tags: ["txline", group.stage?.replace(/_/g, " ") ?? "prematch"],
      },
      {
        ...base,
        id: `${group.groupKey}-markets`,
        type: "signal" as const,
        title: `${marketCount} market${marketCount === 1 ? "" : "s"} active`,
        body: `The agent is tracking ${group.marketTypes.map((item) => item.toUpperCase()).join(", ")} for this fixture and will turn odds movement into short match updates as the game develops.`,
        createdAt: now - index * 180 - 75,
        tags: ["market signal", group.status],
      },
    ];
  });
}

function FeedCard({ item }: { item: AgentFeedItem }) {
  return (
    <article className="border-b border-border/50 px-4 py-4 active:bg-secondary/30 transition-colors">
      <div className="flex gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-primary/12 border border-primary/30 flex items-center justify-center">
          {item.type === "odds_shift" ? (
            <Flame className="w-4 h-4 text-accent" />
          ) : item.type === "signal" ? (
            <Sparkles className="w-4 h-4 text-yellow-300" />
          ) : (
            <Bot className="w-4 h-4 text-primary" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-bold truncate">AI Pundit</span>
                <span className="text-[11px] text-muted-foreground shrink-0">· {formatTime(item.createdAt)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {item.homeTeam} vs {item.awayTeam}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn("text-[9px] px-2 py-0.5 uppercase tracking-widest border shrink-0", TYPE_STYLE[item.type])}
            >
              {labelForType(item.type)}
            </Badge>
          </div>

          <h2 className="mt-3 text-base font-bold leading-snug">{item.title}</h2>
          <p className="mt-2 text-sm leading-6 text-foreground/88">{item.body}</p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex gap-1.5 flex-wrap">
              {item.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-secondary/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
            {item.confidence !== null && (
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {Math.round(item.confidence * 100)}% signal
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Feeds() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");
  const { data: markets, isLoading: marketsLoading, refetch, isFetching } = useMarketsByEpoch();
  const { data: agentFeeds = [], isLoading: feedsLoading, error: feedsError } = useAgentFeeds();

  const groups = useMemo(() => {
    if (!markets) return [];
    return groupMarketsByFixture(flattenMarkets(markets));
  }, [markets]);

  const feeds = useMemo(() => {
    const source = agentFeeds.length > 0 ? agentFeeds : derivedFeeds(groups);
    return source.filter((item) => {
      if (filter === "live") return item.type === "odds_shift" || item.type === "score_update";
      if (filter === "signals") return item.type === "signal" || item.type === "match_read";
      return true;
    });
  }, [agentFeeds, filter, groups]);

  const loading = marketsLoading || feedsLoading;

  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <h1 className="text-base font-bold tracking-tight">Match Feeds</h1>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-live-dot" />
              <span className="text-[10px] font-mono font-bold text-success uppercase tracking-widest">AI live</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            </button>
            <WalletButton />
          </div>
        </div>

        <div className="px-4 pb-3 flex gap-2">
          {(["all", "live", "signals"] as const).map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={filter === item ? "default" : "outline"}
              className="h-8 flex-1 text-[11px] uppercase tracking-widest"
              onClick={() => setFilter(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>

      <main className="flex-1 pb-24 overflow-y-auto">
        {loading && feeds.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
            <p className="text-sm">Loading match feed...</p>
          </div>
        )}

        {feedsError && agentFeeds.length === 0 && (
          <div className="mx-4 mt-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-3 text-xs text-yellow-200">
            Agent feed endpoint is unavailable, showing market-derived updates.
          </div>
        )}

        {!loading && feeds.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Activity className="w-10 h-10 opacity-30" />
            <p className="text-sm">No feed posts yet</p>
            <Button size="sm" variant="outline" onClick={() => setLocation("/markets")}>
              Open Markets
            </Button>
          </div>
        )}

        {feeds.map((item) => (
          <FeedCard key={item.id} item={item} />
        ))}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 max-w-[430px] mx-auto h-[60px] bg-background/95 backdrop-blur border-t border-border/50 flex items-stretch">
        <Link
          href="/markets"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Markets</span>
        </Link>
        <Link
          href="/"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trophy className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bet</span>
        </Link>
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-primary border-t-2 border-primary -mt-px">
          <MessageCircle className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Feeds</span>
        </div>
        <Link
          href="/positions"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <BookMarked className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bets</span>
        </Link>
      </nav>
    </div>
  );
}
