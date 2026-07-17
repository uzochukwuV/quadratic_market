"use client";

import { useMemo } from "react";

import { useProtocol } from "@/hooks/useProtocol";
import { sortEpochs, sortMarkets, type ContractSnapshot } from "@/lib/contract";
import type { EpochAccount, MarketAccount } from "@/lib/types";

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
