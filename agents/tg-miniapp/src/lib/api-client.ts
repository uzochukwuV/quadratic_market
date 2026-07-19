import { useMutation, useQuery } from "@tanstack/react-query";
import { BOT_API_KEY, BOT_API_URL } from "@/lib/bot-api";

export type MarketDetail = {
  market_id: number;
  market_type: string;
  outcomes: Array<{
    label: string;
    price: number;
    probability?: number;
  }>;
};

export type Slip = {
  id: number;
  status: string;
  market_type: string;
  outcome_label: string;
  stake_sol: number;
  potential_payout: number;
  actual_payout?: number | null;
  home_team?: string;
  away_team?: string;
};

export type FixtureSummary = {
  fixture_id: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
};

function headers(): Record<string, string> {
  const value: Record<string, string> = { "Content-Type": "application/json" };
  if (BOT_API_KEY) value["X-API-Key"] = BOT_API_KEY;
  return value;
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BOT_API_URL}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Bot API error ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export function getListSlipsQueryKey() {
  return ["/api/slips"];
}

export function useListSlips(options: any = {}) {
  return useQuery<Slip[]>({
    queryKey: options.query?.queryKey ?? getListSlipsQueryKey(),
    queryFn: () => readJson<Slip[]>("/api/slips"),
    enabled: options.query?.enabled,
  });
}

export function useGetSlip(id: number, options: any = {}) {
  return useQuery<Slip>({
    queryKey: options.query?.queryKey ?? ["/api/slips", id],
    queryFn: () => readJson<Slip>(`/api/slips/${id}`),
    enabled: options.query?.enabled ?? Boolean(id),
  });
}

export function useGetFixtureSummary(
  params: { fixture_id: number },
  options: any = {}
) {
  return useQuery<FixtureSummary>({
    queryKey: options.query?.queryKey ?? ["/api/fixture-summary", params],
    queryFn: () => readJson<FixtureSummary>(`/api/fixture-summary/${params.fixture_id}`),
    enabled: options.query?.enabled,
  });
}

export function usePlaceSlip() {
  return useMutation({
    mutationFn: ({ data }: { data: { market_id: number; outcome_index: number; stake_sol: number } }) =>
      readJson<Slip>("/api/slips", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}
