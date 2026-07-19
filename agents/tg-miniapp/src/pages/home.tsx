import { Link, useLocation, useSearch } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { useTelegramApp } from "@/hooks/use-telegram";
import { useBet } from "@/lib/bet-context";
import { useListSlips } from "@/lib/api-client";
import { WalletButton } from "@/components/wallet-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatSol, cn } from "@/lib/utils";
import { Loader2, Activity, Trophy, LayoutGrid, BookMarked, MessageCircle } from "lucide-react";
import {
  useMarketsByEpoch,
  flattenMarkets,
  groupMarketsByFixture,
  normaliseMType,
  type FixtureGroup,
  type BotMarket,
} from "@/lib/bot-api";
import { bpsToOdds } from "@/lib/solana-config";

/* ── helpers ──────────────────────────────────────────────── */

const TABS = [
  { key: "1x2",        label: "1X2" },
  { key: "over_under", label: "O/U" },
  { key: "gg_ng",      label: "GG/NG" },
] as const;

function outcomeLabels(mtype: string, home: string, away: string): string[] {
  switch (mtype) {
    case "1x2":        return [home, "Draw", away];
    case "over_under": return ["Over 2.5", "Under 2.5"];
    case "gg_ng":      return ["Both Score", "No Goal"];
    default:           return [];
  }
}

type Outcome = { label: string; odds: number | null; price: number };

function buildOutcomes(market: BotMarket, home: string, away: string): Outcome[] {
  const mtype = normaliseMType(market.market_type);
  const labels = outcomeLabels(mtype, home, away);
  return market.odds.slice(0, labels.length).map((bps, i) => {
    const valid = bps >= 10000;
    const dec   = valid ? bpsToOdds(bps) : null;
    return {
      label: labels[i],
      odds:  dec,
      price: dec ? 1 / dec : 0.5,
    };
  });
}

/* ── component ────────────────────────────────────────────── */

export default function Home() {
  useTelegramApp();
  const [, setLocation] = useLocation();
  const search = useSearch();

  const {
    setSelectedMarket,
    selectedOutcomeIndex,
    setSelectedOutcomeIndex,
    stake,
    setStake,
  } = useBet();

  /* Bot API markets */
  const { data: epochData, isLoading } = useMarketsByEpoch();

  const fixtureGroups = useMemo<FixtureGroup[]>(() => {
    const all = epochData ? flattenMarkets(epochData) : [];
    return groupMarketsByFixture(all);
  }, [epochData]);

  /* Find active fixture from URL ?market_id param */
  const marketIdParam = useMemo(() => {
    const v = new URLSearchParams(search).get("market_id");
    return v ? Number(v) : null;
  }, [search]);

  const activeGroup = useMemo<FixtureGroup | null>(() => {
    if (fixtureGroups.length === 0) return null;
    if (!marketIdParam) return fixtureGroups[0];
    return (
      fixtureGroups.find(g => g.markets.some(m => m.market_id === marketIdParam)) ??
      fixtureGroups[0]
    );
  }, [marketIdParam, fixtureGroups]);

  /* Tabs — only show types present in this fixture */
  const availableTabs = useMemo(
    () => TABS.filter(t => activeGroup?.marketTypes.includes(t.key)),
    [activeGroup]
  );

  const [activeTab, setActiveTab] = useState<string>("1x2");

  /* Reset tab & selection when fixture changes */
  useEffect(() => {
    const preferred = activeGroup?.marketTypes.includes("1x2")
      ? "1x2"
      : (activeGroup?.marketTypes[0] ?? "1x2");
    setActiveTab(preferred);
    setSelectedOutcomeIndex(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.groupKey]);

  /* Reset selection when tab changes */
  useEffect(() => {
    setSelectedOutcomeIndex(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /* Current market + outcomes */
  const currentMarket = useMemo(
    () =>
      activeGroup?.markets.find(m => normaliseMType(m.market_type) === activeTab) ?? null,
    [activeGroup, activeTab]
  );

  const outcomes = useMemo<Outcome[]>(
    () =>
      currentMarket && activeGroup
        ? buildOutcomes(currentMarket, activeGroup.homeTeam, activeGroup.awayTeam)
        : [],
    [currentMarket, activeGroup]
  );

  /* Open slips badge */
  const { data: slips } = useListSlips({ query: { queryKey: ["/api/slips"] } });
  const openSlipsCount = slips?.filter((s: any) => s.status === "open").length ?? 0;

  /* Bet state */
  const selectedOutcome =
    selectedOutcomeIndex !== null ? outcomes[selectedOutcomeIndex] ?? null : null;
  const estimatedPayout =
    selectedOutcome?.odds ? stake * selectedOutcome.odds : 0;

  const handleSelectOutcome = (index: number) => {
    if (!currentMarket || !activeGroup) return;
    setSelectedMarket({
      market_id: currentMarket.market_id,
      market_type: normaliseMType(currentMarket.market_type),
      outcomes: outcomes.map(o => ({
        label: o.label,
        price: o.price,
        probability: o.price,
      })),
    } as any);
    setSelectedOutcomeIndex(index);
  };

  /* ── loading / empty states ───────────────────────────── */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh gap-4 text-muted-foreground bg-background">
        <Trophy className="w-12 h-12 opacity-30" />
        <p className="text-sm">No markets available right now</p>
        <Button variant="outline" onClick={() => setLocation("/markets")}>
          Browse Markets
        </Button>
      </div>
    );
  }

  /* ── main render ──────────────────────────────────────── */
  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground pb-6 relative overflow-x-hidden">

      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/50 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold tracking-wide">Sports Markets</span>
        </div>
        <WalletButton />
      </div>

      <main className="flex-1 flex flex-col px-4 pt-6 pb-24">

        {/* Fixture header */}
        <div className="flex flex-col items-center justify-center text-center space-y-3 mb-8">
          <div className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold tracking-widest uppercase mb-1">
            <Activity className="w-3 h-3 mr-1.5" />
            {activeGroup.stage?.replace(/_/g, " ") ?? "PREMATCH"}
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight leading-tight">
            {activeGroup.homeTeam}
            <span className="mx-2 text-muted-foreground font-light text-lg">vs</span>
            {activeGroup.awayTeam}
          </h1>

          <p className="text-sm text-muted-foreground font-mono">
            {new Date(activeGroup.startTime * 1000).toLocaleDateString([], {
              day: "numeric",
              month: "short",
            })}
            {" · "}
            {new Date(activeGroup.startTime * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            KICK-OFF
          </p>
        </div>

        {/* Market tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full flex-1 flex flex-col"
        >
          <TabsList className="w-full mb-6 bg-secondary/50 p-1">
            {availableTabs.map(t => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="text-xs uppercase tracking-wider font-bold flex-1"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent
            value={activeTab}
            className="flex-1 mt-0 animate-in fade-in zoom-in-95 duration-200"
          >
            {outcomes.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                No odds available for this market
              </div>
            ) : (
              <div
                className={cn(
                  "grid gap-3",
                  activeTab === "1x2" ? "grid-cols-3" : "grid-cols-2"
                )}
              >
                {outcomes.map((outcome, idx) => {
                  const isSelected = selectedOutcomeIndex === idx;
                  return (
                    <Button
                      key={idx}
                      variant={isSelected ? "outcomeActive" : "outcome"}
                      size="outcome"
                      onClick={() => handleSelectOutcome(idx)}
                    >
                      <span
                        className={cn(
                          "text-xs font-semibold uppercase tracking-tight text-center leading-tight mb-1",
                          isSelected ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        {outcome.label}
                      </span>
                      <span className="text-xl font-mono font-bold">
                        {outcome.odds ? `${outcome.odds.toFixed(2)}×` : "—"}
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Stake slider */}
            <div
              className={cn(
                "mt-10 p-6 rounded-2xl bg-secondary/30 border border-border/50 transition-all duration-300",
                selectedOutcomeIndex !== null
                  ? "opacity-100 translate-y-0"
                  : "opacity-30 pointer-events-none translate-y-2"
              )}
            >
              <div className="flex justify-between items-end mb-6">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">
                    Stake Size
                  </label>
                  <div className="text-2xl font-mono font-bold text-primary">
                    {formatSol(stake)}
                  </div>
                </div>
                <div className="space-y-1 text-right">
                  <label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">
                    To Win
                  </label>
                  <div className="text-xl font-mono font-medium text-foreground">
                    {formatSol(estimatedPayout)}
                  </div>
                </div>
              </div>

              <Slider
                value={[stake]}
                onValueChange={v => setStake(v[0])}
                max={5}
                min={0.01}
                step={0.01}
                className="py-4"
                disabled={selectedOutcomeIndex === null}
              />
              <div className="flex justify-between mt-2 text-[10px] font-mono text-muted-foreground/60">
                <span>0.01</span>
                <span>5.00</span>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Floating Place Bet CTA */}
      <div className="fixed bottom-[60px] left-0 right-0 px-4 pb-2 bg-gradient-to-t from-background via-background/95 to-transparent backdrop-blur-[2px] z-20 max-w-[430px] mx-auto">
        <Button
          size="lg"
          className={cn(
            "w-full h-14 text-lg font-bold tracking-wide uppercase transition-all duration-300 shadow-xl",
            selectedOutcomeIndex !== null
              ? "shadow-primary/20 translate-y-0 opacity-100"
              : "opacity-50 pointer-events-none translate-y-2"
          )}
          onClick={() => selectedOutcomeIndex !== null && setLocation("/confirm")}
        >
          {selectedOutcomeIndex !== null ? "Place Bet" : "Select an Outcome"}
        </Button>
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 max-w-[430px] mx-auto h-[60px] bg-background/95 backdrop-blur border-t border-border/50 flex items-stretch">
        <Link
          href="/markets"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Markets</span>
        </Link>
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-primary border-t-2 border-primary -mt-px">
          <Trophy className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bet</span>
        </div>
        <Link
          href="/feeds"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Feeds</span>
        </Link>
        <Link
          href="/positions"
          className="flex-1 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors relative"
        >
          <BookMarked className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Bets</span>
          {openSlipsCount > 0 && (
            <span className="absolute top-2 right-6 w-4 h-4 rounded-full bg-primary text-[9px] font-bold flex items-center justify-center text-primary-foreground">
              {openSlipsCount}
            </span>
          )}
        </Link>
      </nav>
    </div>
  );
}
