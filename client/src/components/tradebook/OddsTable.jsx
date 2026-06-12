import React, { useState } from "react";
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
  if (!group) return false; // not in any group → never locked
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
// e.g., "1" in 1X2 context = h2h outcome 0, "GG" in BTTS = btts outcome 0
const COLUMN_TO_OUTCOME = {
  // 1X2 / H2H columns
  '1': { marketKey: 'h2h', outcomeIdx: 0 },
  'X': { marketKey: 'h2h', outcomeIdx: 1 },
  '2': { marketKey: 'h2h', outcomeIdx: 2 },
  // Double Chance
  '1X': { marketKey: 'double_chance', outcomeIdx: 0 },
  'X2': { marketKey: 'double_chance', outcomeIdx: 1 },
  '12': { marketKey: 'double_chance', outcomeIdx: 2 },
  // BTTS
  'GG': { marketKey: 'btts', outcomeIdx: 0 },
  'NG': { marketKey: 'btts', outcomeIdx: 1 },
  // Totals
  'O2.5': { marketKey: 'totals', outcomeIdx: 0 },
  'U2.5': { marketKey: 'totals', outcomeIdx: 1 },
};

export default function OddsTable({ activeMarket, onOddsClick, selectedOdds }) {
  const [animatingId, setAnimatingId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [oddsTableData, setOddsTableData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch odds table data
  React.useEffect(() => {
    const fetchOdds = async () => {
      setIsLoading(true);
      try {
        const data = await getJSON('/odds-table');
        setOddsTableData(data);
      } catch (e) {
        console.error('Failed to fetch odds table:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOdds();
    // Refresh every 30 seconds
    const interval = setInterval(fetchOdds, 30000);
    return () => clearInterval(interval);
  }, []);

  const visibleColumns = marketColumnMap[activeMarket]
    ? oddsColumns.filter((c) => marketColumnMap[activeMarket].includes(c.key))
    : oddsColumns;

  const isSelected = (matchId, market) => {
    return selectedOdds.some((o) => o.matchId === matchId && o.market === market);
  };

  const handleClick = (marketType, outcomeIndex, outcome) => {
    if (!outcome.enabled) return; // Don't click disabled outcomes
    
    const matchId = 1; // Single fixture for now
    const id = `${marketType.key}-${outcomeIndex}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    
    onOddsClick({
      matchId,
      match: oddsTableData?.fixture ? `${oddsTableData.fixture.homeTeam} vs ${oddsTableData.fixture.awayTeam}` : 'Match',
      selection: `${outcome.name} @ ${outcome.odds}`,
      market: marketType.key,
      odds: outcome.odds,
      marketId: marketType.marketId,
      outcomeIndex: outcomeIndex,
      outcomeMints: [],
    });
  };

  // Get odds for a column header from the correct market
  const getOddsForColumn = (colKey, markets) => {
    const mapping = COLUMN_TO_OUTCOME[colKey];
    if (!mapping) return null;
    
    const market = markets?.find(m => m.key === mapping.marketKey);
    if (!market || !market.isActive) return null;
    
    const outcome = market.outcomes?.[mapping.outcomeIdx];
    if (!outcome || !outcome.enabled) return null;
    
    return outcome.odds || null;
  };

  // If no odds table data, show placeholder
  if (isLoading && !oddsTableData) {
    return (
      <div className="border border-light-pearl rounded-lg overflow-hidden">
        <div className="p-8 text-center text-silver-ash">
          Loading odds...
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

      {/* Match row */}
      <div className="flex items-center bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors group">
        <div className="font-inter text-[12px] text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
          {oddsTableData?.fixture ? '24h' : '—'}
        </div>
        <div className="flex-1 min-w-[140px] px-2 py-2.5">
          <span className="font-inter text-[14px] font-semibold text-midnight">
            {oddsTableData?.fixture?.homeTeam || 'Team A'}
          </span>
          <span className="font-inter text-[13px] text-silver-ash mx-1.5">vs</span>
          <span className="font-inter text-[14px] text-dark-shale">
            {oddsTableData?.fixture?.awayTeam || 'Team B'}
          </span>
        </div>
        {visibleColumns.map((col) => {
          const oddsVal = getOddsForColumn(col.key, oddsTableData?.markets);
          const isUnavailable = oddsVal == null || oddsVal === 0;
          
          const btnClass = isUnavailable
            ? "bg-cloud-whisper border-light-pearl text-light-pearl cursor-not-allowed opacity-30"
            : "bg-cloud-whisper border-light-pearl text-midnight hover:border-sunset-orange hover:text-sunset-orange";
          
          return (
            <div key={col.key} className="w-[52px] px-1 py-1.5 shrink-0 flex justify-center">
              <button
                onClick={() => !isUnavailable && handleColumnClick(col.key, oddsTableData?.markets)}
                disabled={isUnavailable}
                className={`w-[44px] py-1 rounded font-inter text-[13px] border transition-all ${btnClass} ${animatingId === `col-${col.key}` ? "odds-pop" : ""}`}
              >
                {oddsVal != null && oddsVal > 0 ? oddsVal.toFixed(2) : "—"}
              </button>
            </div>
          );
        })}
        <div className="w-[44px] shrink-0 flex items-center justify-center">
          <button
            onClick={() => setExpandedMatch(expandedMatch === 'fixture' ? null : 'fixture')}
            className="flex items-center gap-0.5 font-inter text-[12px] text-sunset-orange hover:underline"
          >
            {oddsTableData?.markets?.filter(m => m.isActive).length || 0}
            {expandedMatch === 'fixture' ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded odds table */}
      {expandedMatch === 'fixture' && oddsTableData?.markets && (
        <div className="bg-cloud-whisper px-6 py-4 border-b border-light-pearl">
          <div className="font-inter text-[12px] text-silver-ash mb-2">
            All Markets — {oddsTableData.fixture?.homeTeam} vs {oddsTableData.fixture?.awayTeam}
          </div>
          <div className="space-y-3">
            {oddsTableData.markets.map((marketType) => (
              <div key={marketType.key} className="flex items-center gap-4">
                <div className="font-inter text-[12px] text-silver-ash w-[120px] shrink-0">
                  {marketType.marketTypeName}
                </div>
                <div className="flex gap-2">
                  {marketType.outcomes.map((outcome, idx) => {
                    const sel = selectedOdds.some(
                      o => o.market === marketType.key && o.outcomeIndex === idx
                    );
                    const isDisabled = !outcome.enabled;
                    
                    return (
                      <button
                        key={idx}
                        onClick={() => handleClick(marketType, idx, outcome)}
                        disabled={isDisabled}
                        className={`px-3 py-1.5 rounded-lg font-inter text-[12px] border transition-all ${
                          isDisabled
                            ? "bg-cloud-whisper border-light-pearl text-silver-ash cursor-not-allowed opacity-40"
                            : sel
                            ? "bg-sunset-orange border-sunset-orange text-white"
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Handle column click to open bet slip
function handleColumnClick(colKey, markets) {
  const mapping = COLUMN_TO_OUTCOME[colKey];
  if (!mapping) {
    console.log('Column clicked (no mapping):', colKey);
    return;
  }
  
  const market = markets?.find(m => m.key === mapping.marketKey);
  if (!market || !market.isActive) {
    console.log('Column clicked (market not active):', colKey);
    return;
  }
  
  const outcome = market.outcomes?.[mapping.outcomeIdx];
  if (!outcome || !outcome.enabled) {
    console.log('Column clicked (outcome disabled):', colKey);
    return;
  }
  
  console.log(`Selected: ${colKey} -> ${market.marketTypeName} -> ${outcome.name} @ ${outcome.odds}`);
}