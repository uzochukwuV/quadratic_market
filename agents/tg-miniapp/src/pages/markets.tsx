import { Link, useLocation } from "wouter";
import { useMemo } from "react";
import { WalletButton } from "@/components/wallet-button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  ChevronRight,
  Loader2,
  Trophy,
  LayoutGrid,
  BookMarked,
  RefreshCw,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { bpsToOdds } from "@/lib/solana-config";
import {
  useMarketsByEpoch,
  flattenMarkets,
  groupMarketsByFixture,
  normaliseMType,
  type FixtureGroup,
} from "@/lib/bot-api";

function formatKickoff(unix: number): string {
  try {
    const d = new Date(unix * 1000);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "TBD";
  }
}

// Covers both old (onextwo/overunder/goalnogoal) and new (1x2/over_under/gg_ng) names
const MARKET_TYPE_LABELS: Record<string, string> = {
  "1x2": "1X2",
  onextwo: "1X2",
  over_under: "O/U",
  overunder: "O/U",
  gg_ng: "GG/NG",
  goalnogoal: "GG/NG",
};

const STATUS_COLORS: Record<string, string> = {
  open: "border-primary/30 text-primary bg-primary/5",
  suspended: "border-yellow-500/30 text-yellow-400 bg-yellow-500/5",
  settled: "border-muted/30 text-muted-foreground bg-muted/5",
  voided: "border-destructive/30 text-destructive bg-destructive/5",
  closed: "border-muted/30 text-muted-foreground bg-muted/5",
};

/** Show the best odds from a fixture group's 1x2 market, if available. */
function BestOdds({ group }: { group: FixtureGroup }) {
  const market1x2 = group.markets.find(
    (m) => normaliseMType(m.market_type) === "1x2"
  );
  if (!market1x2 || market1x2.odds.length === 0) return null;
  // Only show if odds look like valid decimal odds (>= 1.00 = >= 10000 bps)
  if (market1x2.odds.some((o) => o < 10000)) return null;

  return (
    <div className="flex gap-1.5 mt-2.5">
      {market1x2.odds.map((bps, i) => {
        const label = i === 0 ? "1" : i === 1 ? "X" : "2";
        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center py-1.5 rounded-lg bg-secondary/40 border border-border/30"
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
            <span className="text-sm font-mono font-bold text-foreground">
              {bpsToOdds(bps).toFixed(2)}×
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Markets() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error, refetch, isFetching } = useMarketsByEpoch();

  const fixtureGroups = useMemo(() => {
    if (!data) return [];
    const all = flattenMarkets(data);
    return groupMarketsByFixture(all);
  }, [data]);

  const openCount = fixtureGroups.filter((g) => g.status === "open").length;

  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h1 className="text-base font-bold tracking-tight">Live Markets</h1>
            {openCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-live-dot" />
                <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest">
                  {openCount} open
                </span>
              </span>
            )}
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
      </div>

      {/* Content */}
      <main className="flex-1 p-4 pb-28 overflow-y-auto space-y-3">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-3 text-primary" />
            <p className="text-sm">Fetching on-chain markets…</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
            Failed to load markets.{" "}
            <button
              onClick={() => refetch()}
              className="underline font-bold"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && fixtureGroups.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Trophy className="w-10 h-10 opacity-30" />
            <p className="text-sm">No live markets at the moment</p>
          </div>
        )}

        {fixtureGroups.map((group) => (
          <button
            key={group.groupKey}
            onClick={() =>
              setLocation(`/?market_id=${group.primaryMarketId}`)
            }
            className={cn(
              "w-full text-left rounded-2xl border border-border/40 bg-card/60 backdrop-blur",
              "hover:border-primary/40 hover:bg-card/80 active:scale-[0.99]",
              "transition-all duration-150 overflow-hidden"
            )}
          >
            {/* League / stage strip */}
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
                Soccer
                {group.stage ? ` · ${group.stage.replace(/_/g, " ")}` : ""}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-2 py-0.5 font-bold uppercase tracking-widest border",
                  STATUS_COLORS[group.status] ?? STATUS_COLORS.open
                )}
              >
                {group.status}
              </Badge>
            </div>

            <div className="px-4 pb-4">
              {/* Teams + kickoff */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex-1">
                  <div className="text-base font-bold text-foreground leading-tight">
                    {group.homeTeam}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-medium mt-0.5">
                    vs
                  </div>
                  <div className="text-base font-bold text-foreground leading-tight">
                    {group.awayTeam}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="w-3 h-3" />
                    <span>
                      {group.startTime > 0
                        ? formatKickoff(group.startTime)
                        : "TBD"}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-primary" />
                </div>
              </div>

              {/* Live odds mini-bar from 1x2 market */}
              <BestOdds group={group} />

              {/* Market type badges */}
              <div className="flex gap-1.5 flex-wrap mt-2.5">
                {group.marketTypes.map((mt) => (
                  <span
                    key={mt}
                    className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-secondary/60 text-muted-foreground"
                  >
                    {MARKET_TYPE_LABELS[mt] ?? mt.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </button>
        ))}

        {/* Data source note */}
        {fixtureGroups.length > 0 && (
          <p className="text-center text-[10px] text-muted-foreground/40 pt-2">
            {data?.count} markets across {data?.epoch_count} epoch
            {(data?.epoch_count ?? 0) !== 1 ? "s" : ""} · on-chain
          </p>
        )}
      </main>

      {/* Bottom Tab Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 max-w-[430px] mx-auto h-[60px] bg-background/95 backdrop-blur border-t border-border/50 flex items-stretch">
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-primary border-t-2 border-primary -mt-px">
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Markets</span>
        </div>
        <Link
          href="/"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trophy className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bet</span>
        </Link>
        <Link
          href="/feeds"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Feeds</span>
        </Link>
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
