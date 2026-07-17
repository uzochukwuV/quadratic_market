"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useProtocol } from "@/hooks/useProtocol";
import { fetchMarketSnapshot, sortEpochs, sortMarkets, type ContractSnapshot, type MarketSnapshot } from "@/lib/contract";
import type { EpochAccount, MarketAccount } from "@/lib/types";
import { useConnection } from "@solana/wallet-adapter-react";

export function useContractSnapshot() {
  const {
    markets,
    epochs,
    marketGroups,
    slips,
    orders,
    pendingLiquidity,
    withdrawals,
    epochVaults,
    epochLpPositions,
    loading,
    error,
    refetch,
  } = useProtocol();

  const snapshot = useMemo<ContractSnapshot>(
    () => ({
      markets,
      epochs,
      marketGroups,
      slips,
      limitOrders: orders,
      pendingLiquidity,
      withdrawalRequests: withdrawals,
      epochVaults,
      epochLpPositions,
    }),
    [epochLpPositions, epochVaults, epochs, marketGroups, markets, orders, pendingLiquidity, slips, withdrawals]
  );

  return { snapshot, loading, error, refresh: refetch };
}

export function useMarketSnapshot() {
  const { connection } = useConnection();
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const refetch = useCallback(() => {
    setRefreshIndex((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!connection) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const result = await fetchMarketSnapshot(connection);
        if (cancelled) return;
        setSnapshot(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load markets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [connection, refreshIndex]);

  return {
    markets: snapshot?.markets ?? [],
    epochs: snapshot?.epochs ?? [],
    marketGroups: snapshot?.marketGroups ?? [],
    loading,
    error,
    refetch,
  };
}

export function useContractMarket(marketId: number) {
  const { snapshot, loading, error, refresh } = useContractSnapshot();
  const market = useMemo(
    () => snapshot.markets.find((entry) => entry.market_id === marketId) ?? null,
    [marketId, snapshot.markets]
  );

  return { market, snapshot, loading, error, refresh };
}

export function useContractEpoch(epochId: number) {
  const { snapshot, loading, error, refresh } = useContractSnapshot();
  const epoch = useMemo(
    () => snapshot.epochs.find((entry) => entry.epoch_id === epochId) ?? null,
    [epochId, snapshot.epochs]
  );

  return { epoch, snapshot, loading, error, refresh };
}

export function useDerivedMarketPrices(market?: MarketAccount | null): [number, number] {
  return useMemo(() => {
    if (!market) return [0.5, 0.5];
    const points = market.price_points.slice(0, market.num_outcomes);
    if (points.length === 0) return [0.5, 0.5];
    const inverse = points.map((pricePoint) => 1 / Math.max(pricePoint, 1));
    const total = inverse.reduce((sum, value) => sum + value, 0) || 1;
    const normalized = inverse.map((value) => value / total);
    return [normalized[0] ?? 0.5, normalized[1] ?? 0.5];
  }, [market]);
}

export function useSortedSnapshot(snapshot: ContractSnapshot | null) {
  return useMemo(() => {
    if (!snapshot) {
      return { epochs: [] as EpochAccount[], markets: [] as MarketAccount[] };
    }

    return {
      epochs: sortEpochs(snapshot.epochs),
      markets: sortMarkets(snapshot.markets),
    };
  }, [snapshot]);
}
