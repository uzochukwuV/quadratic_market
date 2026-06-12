import React, { useState, useEffect } from "react";
import { matchesByLeague as mockMatchesByLeague, oddsColumns, marketColumnMap, oddsLabelMap, exclusiveGroups } from "@/lib/sportsData";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getJSON } from "@/lib/api";

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
  if (!group) return false;
  return selectedOdds.some(
    (o) => o.matchId === matchId && group.includes(o.market) && o.market !== colKey
  );
}

// Market key to category mapping
const MARKET_KEYS = {
  'h2h': 0,
  'btts': 1,
  'totals': 2,
  'draw_no_bet': 3,
  'double_chance': 4,
  'first_half_h2h': 5,
  'gg_ng': 6,
  'odd_even': 7,
};

// Map column keys to market key and outcome index
const COLUMN_TO_OUTCOME = {
  '1': { marketKey: 'h2h', outcomeIdx: 0 },
  'X': { marketKey: 'h2h', outcomeIdx: 1 },
  '2': { marketKey: 'h2h', outcomeIdx: 2 },
  '1X': { marketKey: 'double_chance', outcomeIdx: 0 },
  'X2': { marketKey: 'double_chance', outcomeIdx: 1 },
  '12': { marketKey: 'double_chance', outcomeIdx: 2 },
  'GG': { marketKey: 'btts', outcomeIdx: 0 },
  'NG': { marketKey: 'btts', outcomeIdx: 1 },
  'O2.5': { marketKey: 'totals', outcomeIdx: 0 },
  'U2.5': { marketKey: 'totals', outcomeIdx: 1 },
};

// Market status styling
const STATUS_STYLES = {
  open: {
    enabled: true,
    bgClass: "bg-cloud-whisper",
    borderClass: "border-light-pearl",
    textClass: "text-midnight",
    hoverClass: "hover:border-sunset-orange hover:text-sunset-orange",
    label: "Live"
  },
  preOpen: {
    enabled: true,
    bgClass: "bg-amber-50",
    borderClass: "border-amber-400",
    textClass: "text-amber-700",
    hoverClass: "hover:border-amber-500 hover:text-amber-800",
    label: "Soon"
  },
  inactive: {
    enabled: false,
    bgClass: "bg-cloud-whisper",
    borderClass: "border-light-pearl",
    textClass: "text-light-pearl",
    hoverClass: "",
    label: null
  }
};

function getMarketStatusStyle(market) {
  if (!market) return STATUS_STYLES.inactive;
  if (market.isActive) {
    if (market.status === 'preOpen' || market.status === 'pending') {
      return STATUS_STYLES.preOpen;
    }
    return STATUS_STYLES.open;
  }
  return STATUS_STYLES.inactive;
}

export default function OddsTable({ activeMarket, onOddsClick, selectedOdds }) {
  const [animatingId, setAnimatingId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [marketGroups, setMarketGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchMarketGroups = async () => {
      setIsLoading(true);
      try {
        const data = await getJSON('/market-groups');
        setMarketGroups(data.groups || []);
      } catch (e) {
        console.error('Failed to fetch market groups:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMarketGroups();
    const interval = setInterval(fetchMarketGroups, 30000);
    return () => clearInterval(interval);
  }, []);

  const allMarkets = marketGroups.flatMap(g => g.markets || []);
  const marketsData = allMarkets.map(m => ({
    ...m,
    isActive: m.status === 'open',
    key: m.category === 0 ? 'h2h' : m.category === 1 ? 'btts' : m.category === 2 ? 'totals' : `market_${m.marketId}`,
  }));

  const visibleColumns = marketColumnMap[activeMarket]
    ? oddsColumns.filter((c) => marketColumnMap[activeMarket].includes(c.key))
    : oddsColumns;

  const handleClick = (marketType, outcomeIndex, outcome) => {
    if (!outcome.enabled) return;
    
    const matchId = marketType.groupId || 1;
    const id = `${marketType.key}-${outcomeIndex}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    
    onOddsClick({
      matchId,
      match: marketType.title || 'Match',
      selection: `${outcome.name} @ ${outcome.odds}`,
      market: marketType.key,
      odds: outcome.odds,
      marketId: marketType.marketId,
      outcomeIndex: outcomeIndex,
      outcomeMints: [],
    });
  };

  const handleColumnClick = (colKey) => {
    const mapping = COLUMN_TO_OUTCOME[colKey];
    if (!mapping) return;
    
    const market = marketsData.find(m => m.key === mapping.marketKey);
    if (!market || !market.isActive) return;
    
    const outcome = market.outcomes?.[mapping.outcomeIdx];
    if (!outcome || !outcome.enabled) return;
    
    handleClick(market, mapping.outcomeIdx, outcome);
  };

  if (isLoading && marketGroups.length === 0) {
    return (
      <div className="border border-light-pearl rounded-lg overflow-hidden">
        <div className="p-8 text-center text-silver-ash">
          Loading matches...
        </div>
      </div>
    );
  }

  if (marketGroups.length === 0) {
    return (
      <div className="border border-light-pearl rounded-lg overflow-hidden">
        <div className="p-8 text-center text-silver-ash">
          No matches available
        </div>
      </div>
    );
  }

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

      {/* Render each market group as a match */}
      {marketGroups.map((group) => (
        <div key={group.groupId}>
          {/* Match row */}
          <div className="flex items-center bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors group">
            <div className="font-inter text-[12px] text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
              {group.startTime ? new Date(group.startTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
            <div className="flex-1 min-w-[140px] px-2 py-2.5">
              <span className="font-inter text-[14px] font-semibold text-midnight">
                {group.title}
              </span>
            </div>
            {visibleColumns.map((col) => {
              const mapping = COLUMN_TO_OUTCOME[col.key];
              const market = mapping ? marketsData.find(m => m.key === mapping.marketKey) : null;
              const statusStyle = getMarketStatusStyle(market);
              const oddsVal = market?.outcomes?.[mapping?.outcomeIdx]?.odds;
              const isUnavailable = !market || !statusStyle.enabled || oddsVal == null || oddsVal === 0;
              
              const btnClass = isUnavailable
                ? "bg-cloud-whisper border-light-pearl text-light-pearl cursor-not-allowed opacity-30"
                : `${statusStyle.bgClass} ${statusStyle.borderClass} ${statusStyle.textClass} ${statusStyle.hoverClass}`;
              
              return (
                <div key={col.key} className="w-[52px] px-1 py-1.5 shrink-0 flex justify-center relative">
                  <button
                    onClick={() => !isUnavailable && handleColumnClick(col.key)}
                    disabled={isUnavailable}
                    className={`w-[44px] py-1 rounded font-inter text-[13px] border transition-all ${btnClass} ${animatingId === `col-${col.key}` ? "odds-pop" : ""}`}
                  >
                    {oddsVal != null && oddsVal > 0 ? oddsVal.toFixed(2) : "—"}
                  </button>
                  {statusStyle.label && !isUnavailable && (
                    <span className={`absolute -top-1 -right-1 text-[8px] px-0.5 rounded ${statusStyle.label === 'Soon' ? 'bg-amber-400 text-amber-900' : 'bg-sunset-orange text-white'}`}>
                      {statusStyle.label}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="w-[44px] shrink-0 flex items-center justify-center">
              <button
                onClick={() => setExpandedMatch(expandedMatch === group.groupId ? null : group.groupId)}
                className="flex items-center gap-0.5 font-inter text-[12px] text-sunset-orange hover:underline"
              >
                {marketsData.filter(m => m.isActive).length}
                {expandedMatch === group.groupId ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {/* Expanded markets view */}
          {expandedMatch === group.groupId && (
            <div className="bg-cloud-whisper px-6 py-4 border-b border-light-pearl">
              <div className="font-inter text-[12px] text-silver-ash mb-2">
                All Markets — {group.title}
              </div>
              <div className="space-y-3">
                {marketsData.map((market) => {
                  const statusStyle = getMarketStatusStyle(market);
                  return (
                    <div key={market.marketId} className="flex items-center gap-4">
                      <div className="font-inter text-[12px] text-silver-ash w-[120px] shrink-0 flex items-center gap-1">
                        {market.title}
                        {statusStyle.label && (
                          <span className={`text-[9px] px-1 rounded ${statusStyle.label === 'Soon' ? 'bg-amber-400 text-amber-900' : 'bg-sunset-orange text-white'}`}>
                            {statusStyle.label}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {market.outcomes?.map((outcome, idx) => {
                          const sel = selectedOdds.some(
                            o => o.marketId === market.marketId && o.outcomeIndex === idx
                          );
                          const isDisabled = !outcome.enabled || !statusStyle.enabled;
                          
                          return (
                            <button
                              key={idx}
                              onClick={() => handleClick(market, idx, outcome)}
                              disabled={isDisabled}
                              className={`px-3 py-1.5 rounded-lg font-inter text-[12px] border transition-all ${
                                isDisabled
                                  ? "bg-cloud-whisper border-light-pearl text-silver-ash cursor-not-allowed opacity-40"
                                  : sel
                                  ? "bg-sunset-orange border-sunset-orange text-white"
                                  : statusStyle.label === 'Soon'
                                  ? "bg-amber-50 border-amber-400 text-amber-700 hover:border-amber-500"
                                  : "bg-canvas border-light-pearl text-midnight hover:border-sunset-orange"
                              }`}
                            >
                              <span className="text-silver-ash mr-1">{outcome.name}</span>
                              <span className="font-semibold">
                                {outcome.odds > 0 ? outcome.odds.toFixed(2) : '—'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
