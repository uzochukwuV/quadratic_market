"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Betslip } from "./Betslip";
import { useBaseTokenBalance, useMarkets, useMintBaseToken, usePlaceSlipAwait } from "@/hooks";
import { Icon, marketLabel } from "./Icon";
import { MarketBoard } from "./MarketBoard";
import { normalizeMarkets } from "./normalize";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { Fixture, MarketTabKey, Outcome, Pick, SlipMode, Status } from "./types";

const BASE_DECIMALS = 1_000_000;

export function MarketDashboard() {
  const wallet = useWallet();
  const markets = useMarkets();
  const placeSlip = usePlaceSlipAwait();
  const baseBalance = useBaseTokenBalance();
  const mintBase = useMintBaseToken(baseBalance.refetch);
  const [status, setStatus] = useState<Status>("prematch");
  const [activeMarket, setActiveMarket] = useState<MarketTabKey>("popular");
  const [query, setQuery] = useState("");
  const [stake, setStake] = useState("1");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [slipMode, setSlipMode] = useState<SlipMode>("multiple");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const chainFixtures = useMemo(() => normalizeMarkets(markets.data ?? []), [markets.data]);
  const dashboardFixtures = chainFixtures;

  console.log("[dashboard] market state", {
    loading: markets.loading,
    error: markets.error?.message ?? null,
    rawMarketCount: markets.data?.length ?? 0,
    fixtureCount: dashboardFixtures.length,
    activeStatus: status,
    activeMarket,
    query,
  });

  const filteredFixtures = useMemo(() => {
    const filtered = dashboardFixtures.filter((fixture) => {
      const haystack = `${fixture.code} ${fixture.home} ${fixture.away} ${fixture.league} ${fixture.country}`.toLowerCase();
      return fixture.status === status && haystack.includes(query.trim().toLowerCase());
    });
    console.log("[dashboard] filtered fixtures", {
      before: dashboardFixtures.length,
      after: filtered.length,
      status,
      query,
    });
    return filtered;
  }, [dashboardFixtures, query, status]);

  const groupedFixtures = useMemo(() => {
    const grouped = filteredFixtures.reduce<Record<string, Fixture[]>>((groups, fixture) => {
      const key = `${fixture.country} - ${fixture.league}`;
      groups[key] = [...(groups[key] ?? []), fixture];
      return groups;
    }, {});
    console.log("[dashboard] grouped fixtures", {
      groups: Object.keys(grouped),
      fixtureCount: filteredFixtures.length,
    });
    return grouped;
  }, [filteredFixtures]);

  const totalOdds = picks.reduce((total, pick) => total * pick.outcome.odds, 1);
  const stakeValue = Number(stake || 0);
  const multipleReturn = picks.length ? stakeValue * totalOdds : 0;
  const singlesReturn = picks.reduce((total, pick) => total + stakeValue * pick.outcome.odds, 0);
  const potentialReturn = slipMode === "multiple" ? multipleReturn : singlesReturn;
  const hasOnlyChainPicks = picks.length > 0 && picks.every((pick) => pick.fixture.source === "chain" && /^\d+$/.test(pick.outcome.marketId));
  const placing = placeSlip.loading || mintBase.status === "minting";
  const canPlace = Boolean(wallet.connected && hasOnlyChainPicks && stakeValue > 0 && !placing);

  function choose(fixture: Fixture, outcome: Outcome) {
    setPicks((current) => {
      const selected = current.some((pick) => pick.outcome.id === outcome.id);
      if (selected) {
        setNotice("");
        return current.filter((pick) => pick.outcome.id !== outcome.id);
      }

      const replacing = current.find((pick) => pick.outcome.marketId === outcome.marketId);
      setNotice(
        replacing
          ? `${marketLabel(outcome.marketKey)} for #${fixture.code}: ${replacing.outcome.code} replaced with ${outcome.code}`
          : "",
      );

      return [
        ...current.filter((pick) => pick.outcome.marketId !== outcome.marketId),
        { fixture, outcome },
      ];
    });
  }

  function isSelected(outcomeId: string) {
    return picks.some((pick) => pick.outcome.id === outcomeId);
  }

  function isSameMarketAlternative(outcome: Outcome) {
    return picks.some((pick) => pick.outcome.marketId === outcome.marketId && pick.outcome.id !== outcome.id);
  }

  async function submitSlip() {
    if (!canPlace) return;

    try {
      const stakeInBaseUnits = BigInt(Math.round(stakeValue * BASE_DECIMALS));
      const currentBaseBalance = baseBalance.amount ?? BigInt(0);
      if (currentBaseBalance < stakeInBaseUnits) {
        const missing = stakeInBaseUnits - currentBaseBalance;
        const minted = await mintBase.mint(Number(missing));
        if (!minted) return;
      }

      const cancelDeadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      await placeSlip.placeSlip(
        picks.map((pick) => ({
          marketId: pick.outcome.marketId,
          outcomeId: pick.outcome.outcomeId,
          numShares: stakeInBaseUnits,
        })),
        stakeInBaseUnits,
        cancelDeadline,
      );
      await markets.refetch();
    } catch {
      // The action hook owns the displayed error state.
    }
  }

  return (
    <main className="app-shell">
      <Topbar />

      <div className="dashboard">
        <Sidebar />

        <div>
          <section className="market-summary">
            <div>
              <span className="eyebrow">TXODDS FEED</span>
              <h1>Market dashboard</h1>
              <p>{markets.loading ? "Loading on-chain markets" : markets.error ? "Market fetch failed" : `On-chain market feed - ${markets.data?.length ?? 0} markets`}</p>
            </div>
            <div className="summary-grid">
              <div><span>Open fixtures</span><b>{dashboardFixtures.filter((fixture) => fixture.status === "prematch").length}</b></div>
              <div><span>Live fixtures</span><b>{dashboardFixtures.filter((fixture) => fixture.status === "live").length}</b></div>
              <div><span>Slip legs</span><b>{picks.length}</b></div>
            </div>
          </section>

          <MarketBoard
            status={status}
            setStatus={setStatus}
            query={query}
            setQuery={setQuery}
            activeMarket={activeMarket}
            setActiveMarket={setActiveMarket}
            groupedFixtures={groupedFixtures}
            notice={markets.error ? `Market fetch failed: ${markets.error.message}` : notice}
            loading={markets.loading}
            error={markets.error?.message}
            choose={choose}
            isSelected={isSelected}
            isSameMarketAlternative={isSameMarketAlternative}
          />
        </div>

        <Betslip
          className="desktop-slip"
          picks={picks}
          stake={stake}
          setStake={setStake}
          totalOdds={totalOdds}
          potentialReturn={potentialReturn}
          slipMode={slipMode}
          setSlipMode={setSlipMode}
          remove={(id) => setPicks((current) => current.filter((pick) => pick.outcome.id !== id))}
          clear={() => setPicks([])}
          placeBet={() => void submitSlip()}
          placing={placing}
          canPlace={canPlace}
          placeError={placeSlip.error?.message ?? mintBase.error}
          signature={placeSlip.signature ?? ""}
        />
      </div>

      <button className="mobile-slip-button" onClick={() => setDrawerOpen(true)}>
        <Icon name="ticket" />
        <span>Betslip</span>
        <b>{picks.length}</b>
        {picks.length > 0 && <em>{totalOdds.toFixed(2)}</em>}
      </button>

      {drawerOpen && (
        <div className="mobile-overlay" onClick={() => setDrawerOpen(false)}>
          <div onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close betslip"><Icon name="x" /></button>
            <Betslip
              picks={picks}
              stake={stake}
              setStake={setStake}
              totalOdds={totalOdds}
              potentialReturn={potentialReturn}
              slipMode={slipMode}
              setSlipMode={setSlipMode}
              remove={(id) => setPicks((current) => current.filter((pick) => pick.outcome.id !== id))}
              clear={() => setPicks([])}
              placeBet={() => void submitSlip()}
              placing={placing}
              canPlace={canPlace}
              placeError={placeSlip.error?.message ?? mintBase.error}
              signature={placeSlip.signature ?? ""}
            />
          </div>
        </div>
      )}
    </main>
  );
}
