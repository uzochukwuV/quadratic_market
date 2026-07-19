"use client";

import type { Fixture, MarketTabKey, Outcome, Status } from "./types";
import { Icon } from "./Icon";
import { marketTabs } from "./data";

const popularCodes = ["1", "X", "2", "O2.5", "U2.5", "GG", "NG"];

function headerCodes(activeMarket: MarketTabKey) {
  if (activeMarket === "popular") return popularCodes;
  if (activeMarket === "match_result") return ["1", "X", "2"];
  if (activeMarket === "total_goals") return ["O2.5", "U2.5"];
  return ["GG", "NG"];
}

export function MarketBoard({
  status,
  setStatus,
  query,
  setQuery,
  activeMarket,
  setActiveMarket,
  groupedFixtures,
  notice,
  choose,
  isSelected,
}: {
  status: Status;
  setStatus: (status: Status) => void;
  query: string;
  setQuery: (query: string) => void;
  activeMarket: MarketTabKey;
  setActiveMarket: (market: MarketTabKey) => void;
  groupedFixtures: Record<string, Fixture[]>;
  notice: string;
  choose: (fixture: Fixture, outcome: Outcome) => void;
  isSelected: (outcomeId: string) => boolean;
}) {
  const codes = headerCodes(activeMarket);
  const gridClass = activeMarket === "popular" ? "popular" : codes.length === 2 ? "focused-two" : "focused-three";

  return (
    <section className="market-area">
      <div className="market-toolbar">
        <div className="tabs" role="tablist" aria-label="Fixture status">
          <button onClick={() => setStatus("prematch")} className={status === "prematch" ? "active" : ""}>Prematch</button>
          <button onClick={() => setStatus("live")} className={status === "live" ? "active live-tab" : "live-tab"}><i /> Live</button>
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fixtures" />
        </label>
      </div>

      <div className="market-chips" aria-label="Market filter">
        {marketTabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveMarket(tab.key)} className={activeMarket === tab.key ? "active" : ""}>
            {tab.label}
          </button>
        ))}
      </div>

      {notice && <div className="selection-notice">{notice}</div>}

      <div className="fixtures">
        <div className={`column-head ${gridClass}-head`}>
          <span>Event</span>
          <div>
            {codes.map((code) => <span key={code}>{code}</span>)}
            <span>More</span>
          </div>
        </div>

        {Object.entries(groupedFixtures).map(([group, groupFixtures]) => (
          <div className="league-group" key={group}>
            <div className="league-head">
              <span>{groupFixtures[0].country.slice(0, 2).toUpperCase()}</span>
              <div>
                <b>{groupFixtures[0].league}</b>
                <small>{groupFixtures[0].country}</small>
              </div>
              <button aria-label={`Open ${groupFixtures[0].league}`}><Icon name="chevron" size={14} /></button>
            </div>

            {groupFixtures.map((fixture) => {
              const outcomes = activeMarket === "popular" ? fixture.outcomes : fixture.outcomes.filter((outcome) => outcome.marketKey === activeMarket);

              return (
                <div className={`match-row ${gridClass}-row`} key={fixture.id}>
                  <div className="event-cell">
                    <div className={fixture.status === "live" ? "event-time live-time" : "event-time"}>
                      {fixture.status === "live" ? <><i />{fixture.minute}</> : fixture.start}
                    </div>
                    <div className="teams">
                      <span>{fixture.home}</span>
                      <span>{fixture.away}</span>
                      {fixture.score && <b>{fixture.score}</b>}
                    </div>
                    <div className="event-meta">
                      <span>#{fixture.code}</span>
                      <span>{fixture.liquidity}</span>
                    </div>
                  </div>

                  <div className="odds-grid">
                    {outcomes.map((outcome) => (
                      <button key={outcome.id} onClick={() => choose(fixture, outcome)} className={isSelected(outcome.id) ? "odd selected" : `odd ${outcome.trend}`}>
                        <small>{outcome.code}</small>
                        <b>{outcome.odds.toFixed(2)}</b>
                      </button>
                    ))}
                    <button className="more">
                      +{fixture.moreMarkets}
                      <Icon name="chevron" size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {!Object.keys(groupedFixtures).length && <div className="empty-results">No fixtures match this view.</div>}
      </div>

      <p className="disclaimer">Demo odds only. Please bet responsibly. 18+</p>
    </section>
  );
}
