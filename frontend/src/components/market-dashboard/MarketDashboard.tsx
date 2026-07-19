"use client";

import { useMemo, useState } from "react";
import { Betslip } from "./Betslip";
import { fixtures } from "./data";
import { Icon, marketLabel } from "./Icon";
import { MarketBoard } from "./MarketBoard";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { Fixture, MarketTabKey, Outcome, Pick, SlipMode, Status } from "./types";

export function MarketDashboard() {
  const [status, setStatus] = useState<Status>("prematch");
  const [activeMarket, setActiveMarket] = useState<MarketTabKey>("popular");
  const [query, setQuery] = useState("");
  const [stake, setStake] = useState("500");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [slipMode, setSlipMode] = useState<SlipMode>("multiple");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const filteredFixtures = useMemo(() => {
    return fixtures.filter((fixture) => {
      const haystack = `${fixture.code} ${fixture.home} ${fixture.away} ${fixture.league} ${fixture.country}`.toLowerCase();
      return fixture.status === status && haystack.includes(query.trim().toLowerCase());
    });
  }, [query, status]);

  const groupedFixtures = useMemo(() => {
    return filteredFixtures.reduce<Record<string, Fixture[]>>((groups, fixture) => {
      const key = `${fixture.country} - ${fixture.league}`;
      groups[key] = [...(groups[key] ?? []), fixture];
      return groups;
    }, {});
  }, [filteredFixtures]);

  const totalOdds = picks.reduce((total, pick) => total * pick.outcome.odds, 1);
  const stakeValue = Number(stake || 0);
  const multipleReturn = picks.length ? stakeValue * totalOdds : 0;
  const singlesReturn = picks.reduce((total, pick) => total + stakeValue * pick.outcome.odds, 0);
  const potentialReturn = slipMode === "multiple" ? multipleReturn : singlesReturn;

  function choose(fixture: Fixture, outcome: Outcome) {
    setPicks((current) => {
      const selected = current.some((pick) => pick.outcome.id === outcome.id);
      if (selected) {
        setNotice("");
        return current.filter((pick) => pick.outcome.id !== outcome.id);
      }

      const replacing = current.some((pick) => pick.outcome.marketId === outcome.marketId);
      setNotice(replacing ? `Replaced ${marketLabel(outcome.marketKey)} selection for ${fixture.code}` : "");

      return [
        ...current.filter((pick) => pick.outcome.marketId !== outcome.marketId),
        { fixture, outcome },
      ];
    });
  }

  function isSelected(outcomeId: string) {
    return picks.some((pick) => pick.outcome.id === outcomeId);
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
            </div>
            <div className="summary-grid">
              <div><span>Open fixtures</span><b>{fixtures.filter((fixture) => fixture.status === "prematch").length}</b></div>
              <div><span>Live fixtures</span><b>{fixtures.filter((fixture) => fixture.status === "live").length}</b></div>
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
            notice={notice}
            choose={choose}
            isSelected={isSelected}
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
            />
          </div>
        </div>
      )}
    </main>
  );
}
