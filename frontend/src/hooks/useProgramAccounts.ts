"use client";

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  fetchAllEpochs,
  fetchAllEpochVaults,
  fetchAllMarketGroups,
  fetchAllMarkets,
  fetchAllSlips,
  fetchEpoch,
  fetchEpochLpPosition,
  fetchEpochVault,
  fetchGlobalConfig,
  fetchMarket,
  fetchMarketGroup,
  fetchOpenMarkets,
  fetchSlip,
  fetchUserEpochLpPositions,
  fetchUserSlips,
} from "@/lib/solana/accounts";
import { useQuadraticProgram } from "./useQuadraticProgram";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

function useProgramQuery<T>(label: string, query: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function refetch() {
    console.log(`[program-query:${label}] refetch:start`);
    setLoading(true);
    setError(null);
    try {
      const result = await query();
      console.log(`[program-query:${label}] refetch:success`, {
        isArray: Array.isArray(result),
        count: Array.isArray(result) ? result.length : undefined,
        result,
      });
      setData(result);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      console.error(`[program-query:${label}] refetch:error`, error);
      setError(error);
    } finally {
      console.log(`[program-query:${label}] refetch:done`);
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
  return useProgramQuery("globalConfig", async () => (program ? fetchGlobalConfig(program) : null), [program]);
}

export function useMarkets() {
  const program = useQuadraticProgram();
  return useProgramQuery("markets", async () => (program ? fetchAllMarkets(program) : []), [program]);
}

export function useOpenMarkets() {
  const program = useQuadraticProgram();
  return useProgramQuery("openMarkets", async () => (program ? fetchOpenMarkets(program) : []), [program]);
}

export function useMarket(marketId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("market", async () => (program && marketId != null ? fetchMarket(program, marketId) : null), [
    program,
    marketId,
  ]);
}

export function useMarketGroups() {
  const program = useQuadraticProgram();
  return useProgramQuery("marketGroups", async () => (program ? fetchAllMarketGroups(program) : []), [program]);
}

export function useEpochs() {
  const program = useQuadraticProgram();
  return useProgramQuery("epochs", async () => (program ? fetchAllEpochs(program) : []), [program]);
}

export function useEpochVaults() {
  const program = useQuadraticProgram();
  return useProgramQuery("epochVaults", async () => (program ? fetchAllEpochVaults(program) : []), [program]);
}

export function useMarketGroup(groupId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("marketGroup", async () => (program && groupId != null ? fetchMarketGroup(program, groupId) : null), [
    program,
    groupId,
  ]);
}

export function useSlips() {
  const program = useQuadraticProgram();
  return useProgramQuery("slips", async () => (program ? fetchAllSlips(program) : []), [program]);
}

export function useSlip(slipId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("slip", async () => (program && slipId != null ? fetchSlip(program, slipId) : null), [
    program,
    slipId,
  ]);
}

export function useUserSlips(owner?: PublicKey | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("userSlips", async () => (program && owner ? fetchUserSlips(program, owner) : []), [
    program,
    owner?.toBase58(),
  ]);
}

export function useEpoch(epochId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("epoch", async () => (program && epochId != null ? fetchEpoch(program, epochId) : null), [
    program,
    epochId,
  ]);
}

export function useEpochVault(epochId?: bigint | number | string | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("epochVault", async () => (program && epochId != null ? fetchEpochVault(program, epochId) : null), [
    program,
    epochId,
  ]);
}

export function useEpochLpPosition(epochId?: bigint | number | string | null, owner?: PublicKey | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("epochLpPosition", async () => {
    if (!program || epochId == null || !owner) return null;
    try {
      return await fetchEpochLpPosition(program, epochId, owner);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.toLowerCase().includes("account does not exist")) return null;
      throw caught;
    }
  }, [
    program,
    epochId,
    owner?.toBase58(),
  ]);
}

export function useUserEpochLpPositions(owner?: PublicKey | null) {
  const program = useQuadraticProgram();
  return useProgramQuery("userEpochLpPositions", async () => (program && owner ? fetchUserEpochLpPositions(program, owner) : []), [
    program,
    owner?.toBase58(),
  ]);
}
