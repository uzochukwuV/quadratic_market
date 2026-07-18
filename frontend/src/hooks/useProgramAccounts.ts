"use client";

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  fetchAllMarketGroups,
  fetchAllMarkets,
  fetchAllSlips,
  fetchEpoch,
  fetchEpochVault,
  fetchGlobalConfig,
  fetchMarket,
  fetchMarketGroup,
  fetchOpenMarkets,
  fetchSlip,
  fetchUserSlips,
} from "@/lib/solana/accounts";
import { useQuadraticProgram } from "./useQuadraticProgram";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

function useProgramQuery<T>(query: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function refetch() {
    setLoading(true);
    setError(null);
    try {
      setData(await query());
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch };
}

export function useGlobalConfig() {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program ? fetchGlobalConfig(program) : null), [program]);
}

export function useMarkets() {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program ? fetchAllMarkets(program) : []), [program]);
}

export function useOpenMarkets() {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program ? fetchOpenMarkets(program) : []), [program]);
}

export function useMarket(marketId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && marketId != null ? fetchMarket(program, marketId) : null), [
    program,
    marketId,
  ]);
}

export function useMarketGroups() {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program ? fetchAllMarketGroups(program) : []), [program]);
}

export function useMarketGroup(groupId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && groupId != null ? fetchMarketGroup(program, groupId) : null), [
    program,
    groupId,
  ]);
}

export function useSlips() {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program ? fetchAllSlips(program) : []), [program]);
}

export function useSlip(slipId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && slipId != null ? fetchSlip(program, slipId) : null), [
    program,
    slipId,
  ]);
}

export function useUserSlips(owner?: PublicKey | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && owner ? fetchUserSlips(program, owner) : []), [
    program,
    owner?.toBase58(),
  ]);
}

export function useEpoch(epochId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && epochId != null ? fetchEpoch(program, epochId) : null), [
    program,
    epochId,
  ]);
}

export function useEpochVault(epochId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery(async () => (program && epochId != null ? fetchEpochVault(program, epochId) : null), [
    program,
    epochId,
  ]);
}
