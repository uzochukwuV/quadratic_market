import React, { useState } from "react";
import { matchesByLeague as mockMatchesByLeague, oddsColumns, marketColumnMap, oddsLabelMap, exclusiveGroups } from "@/lib/sportsData";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useLiveMarkets } from "@/lib/api";

/** Return the exclusive group that contains colKey, or null. */
function getGroup(colKey) {
  return exclusiveGroups.find((g) => g.includes(colKey)) ?? null;
}

/**
 * Given the selectedOdds for a match and a column key, return whether
 * a different key in the same exclusive group is already selected.
 * If so, this button should be locked out (greyed, not clickable).
 */
function isGroupLocked(matchId, colKey, selectedOdds) {
  const group = getGroup(colKey);
  if (!group) return false; // not in any group → never locked
  return selectedOdds.some(
    (o) => o.matchId === matchId && group.includes(o.market) && o.market !== colKey
  );
}

export default function OddsTable({ activeMarket, onOddsClick, selectedOdds }) {
  const [animatingId, setAnimatingId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);

  // Prefer live data from /markets; fall back to static mock while loading
  const { matchesByLeague: liveLeagues, isLoading } = useLiveMarkets();
  const matchesByLeague = liveLeagues.length > 0 ? liveLeagues : mockMatchesByLeague;

  const visibleColumns = marketColumnMap[activeMarket]
    ? oddsColumns.filter((c) => marketColumnMap[activeMarket].includes(c.key))
    : oddsColumns;

  const isSelected = (matchId, market) => {
    return selectedOdds.some((o) => o.matchId === matchId && o.market === market);
  };

  const handleClick = (match, col) => {
    // For live matches use market_id as matchId; for mocks use match.id
    const matchId = match.marketId ?? match.id;
    const id = `${matchId}-${col.key}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    onOddsClick({
      matchId,
      match: `${match.home} vs ${match.away}`,
      selection: `${col.key} (${oddsLabelMap[col.key] || col.key})`,
      market: col.key,
      odds: match.odds[col.key],
      // pass through metadata the slip builder needs
      marketId: match.marketId,
      outcomeIndex: ['1', 'X', '2', 'GG', 'NG'].indexOf(col.key),
      outcomeMints: match.outcomeMints,
    });
  };

  return (
    <div className="border border-light-pearl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-slate-mist flex items-center sticky top-0 z-10">
        <div className="font-inter text-[12px] font-semibold text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
          Time
        </div>
        <div className="font-inter text-[12px] font-semibold text-silver-ash flex-1 min-w-[140px] px-2 py-2.5">
          Match
        </div>
        {visibleColumns.map((col) => (
          <div
            key={col.key}
            className="font-inter text-[12px] font-semibold text-silver-ash w-[52px] text-center px-1 py-2.5 shrink-0"
          >
            {col.label}
          </div>
        ))}
        <div className="w-[44px] shrink-0" />
      </div>

      {/* Leagues */}
      {matchesByLeague.map((league) => (
        <div key={league.league}>
          <div className="bg-cloud-whisper px-4 py-2 border-b border-light-pearl">
            <span className="font-inter text-[13px] font-bold text-dark-shale">{league.league}</span>
          </div>
          {league.matches.map((match) => {
            const matchId = match.marketId ?? match.id;
            return (
              <React.Fragment key={match.id}>
                <div className="flex items-center bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors group">
                  <div className="font-inter text-[12px] text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
                    {match.time}
                  </div>
                  <div className="flex-1 min-w-[140px] px-2 py-2.5">
                    <span className="font-inter text-[14px] font-semibold text-midnight">{match.home}</span>
                    <span className="font-inter text-[13px] text-silver-ash mx-1.5">vs</span>
                    <span className="font-inter text-[14px] text-dark-shale">{match.away}</span>
                  </div>
                  {visibleColumns.map((col) => {
                    const btnId   = `${matchId}-${col.key}`;
                    const sel     = isSelected(matchId, col.key);
                    const oddsVal = match.odds[col.key];
                    const status  = match.status;

                    const isUnavailable = oddsVal == null;
                    const isPreOpen     = status === "PreOpen";
                    const isInactive    = status && status !== "Open" && status !== "PreOpen";
                    // Another outcome in the same exclusive group is already selected
                    const isLocked      = !sel && isGroupLocked(matchId, col.key, selectedOdds);

                    const btnClass = isUnavailable
                      ? "bg-cloud-whisper border-light-pearl text-light-pearl cursor-not-allowed opacity-30"
                      : isInactive
                      ? "bg-cloud-whisper border-light-pearl text-silver-ash cursor-not-allowed opacity-50"
                      : isLocked
                      ? "bg-cloud-whisper border-light-pearl text-silver-ash cursor-not-allowed opacity-40"
                      : sel
                      ? "bg-sunset-orange border-sunset-orange text-white font-semibold"
                      : isPreOpen
                      ? "bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                      : "bg-cloud-whisper border-light-pearl text-midnight hover:border-sunset-orange hover:text-sunset-orange";

                    return (
                      <div key={col.key} className="w-[52px] px-1 py-1.5 shrink-0 flex justify-center">
                        <button
                          onClick={() => !isUnavailable && !isInactive && !isLocked && handleClick(match, col)}
                          disabled={isUnavailable || isInactive || isLocked}
                          className={`w-[44px] py-1 rounded font-inter text-[13px] border transition-all ${btnClass} ${animatingId === btnId ? "odds-pop" : ""}`}
                        >
                          {oddsVal != null ? oddsVal.toFixed(2) : "—"}
                        </button>
                      </div>
                    );
                  })}
                  <div className="w-[44px] shrink-0 flex items-center justify-center">
                    <button
                      onClick={() => setExpandedMatch(expandedMatch === matchId ? null : matchId)}
                      className="flex items-center gap-0.5 font-inter text-[12px] text-sunset-orange hover:underline"
                    >
                      +{match.more ?? 0}
                      {expandedMatch === matchId ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
                {expandedMatch === matchId && (
                  <div className="bg-cloud-whisper px-6 py-4 border-b border-light-pearl">
                    <div className="font-inter text-[12px] text-silver-ash mb-2">All Markets — {match.home} vs {match.away}</div>
                    <div className="flex flex-wrap gap-2">
                      {oddsColumns.map((col) => {
                        const sel      = isSelected(matchId, col.key);
                        const oddsVal  = match.odds[col.key];
                        const status   = match.status;
                        const isInactive = status && status !== "Open" && status !== "PreOpen";
                        const isPreOpen  = status === "PreOpen";
                        const isLocked   = !sel && isGroupLocked(matchId, col.key, selectedOdds);
                        if (oddsVal == null) return null;
                        return (
                          <button
                            key={col.key}
                            onClick={() => !isInactive && !isLocked && handleClick(match, col)}
                            disabled={isInactive || isLocked}
                            className={`px-3 py-1.5 rounded-lg font-inter text-[12px] border transition-all ${
                              isInactive || isLocked
                                ? "bg-cloud-whisper border-light-pearl text-silver-ash cursor-not-allowed opacity-40"
                                : sel
                                ? "bg-sunset-orange border-sunset-orange text-white"
                                : isPreOpen
                                ? "bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                                : "bg-canvas border-light-pearl text-midnight hover:border-sunset-orange"
                            }`}
                          >
                            <span className="text-silver-ash mr-1">{col.label}</span>
                            <span className="font-semibold">{oddsVal.toFixed(2)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}