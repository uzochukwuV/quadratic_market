export type MarketKey = "match_result" | "total_goals" | "gg_ng";
export type Status = "prematch" | "live";

export type Outcome = {
  id: string;
  marketId: string;
  marketAccount?: string;
  outcomeId: number;
  marketKey: MarketKey;
  code: string;
  label: string;
  odds: number;
  trend: "up" | "down" | "flat";
};

export type Fixture = {
  id: string;
  code: string;
  start: string;
  status: Status;
  minute?: string;
  score?: string;
  country: string;
  league: string;
  home: string;
  away: string;
  liquidity: string;
  moreMarkets: number;
  source: "chain" | "demo";
  outcomes: Outcome[];
};

export type Pick = {
  fixture: Fixture;
  outcome: Outcome;
};

export type MarketTabKey = "popular" | MarketKey;
export type SlipMode = "multiple" | "singles";
