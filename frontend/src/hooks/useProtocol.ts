"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchContractSnapshot,
  type UiEpochAccount,
  type UiEpochLpPositionAccount,
  type UiEpochVaultAccount,
  type UiLimitOrderAccount,
  type UiMarketAccount,
  type UiMarketGroupAccount,
  type UiPendingLiquidityAccount,
  type UiSlipAccount,
  type UiWithdrawalRequestAccount,
} from "@/lib/contract";

export function useProtocol() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [markets, setMarkets] = useState<UiMarketAccount[]>([]);
  const [epochs, setEpochs] = useState<UiEpochAccount[]>([]);
  const [marketGroups, setMarketGroups] = useState<UiMarketGroupAccount[]>([]);
  const [slips, setSlips] = useState<UiSlipAccount[]>([]);
  const [orders, setOrders] = useState<UiLimitOrderAccount[]>([]);
  const [pendingLiquidity, setPendingLiquidity] = useState<UiPendingLiquidityAccount[]>([]);
  const [withdrawals, setWithdrawals] = useState<UiWithdrawalRequestAccount[]>([]);
  const [epochVaults, setEpochVaults] = useState<UiEpochVaultAccount[]>([]);
  const [epochLpPositions, setEpochLpPositions] = useState<UiEpochLpPositionAccount[]>([]);
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

        const snapshot = await fetchContractSnapshot(connection);

        if (cancelled) return;

        setMarkets(snapshot.markets);
        setEpochs(snapshot.epochs);
        setMarketGroups(snapshot.marketGroups);
        setSlips(snapshot.slips);
        setOrders(snapshot.limitOrders);
        setPendingLiquidity(snapshot.pendingLiquidity);
        setWithdrawals(snapshot.withdrawalRequests);
        setEpochVaults(snapshot.epochVaults);
        setEpochLpPositions(snapshot.epochLpPositions);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load protocol state");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [connection, refreshIndex]);

  const userEpochPositions = useMemo(() => {
    if (!publicKey) return [];
    const owner = publicKey.toBase58();
    return epochLpPositions.filter((position) => position.owner === owner);
  }, [epochLpPositions, publicKey]);

  const userPendingLiquidity = useMemo(() => {
    if (!publicKey) return [];
    const owner = publicKey.toBase58();
    return pendingLiquidity.filter((item) => item.lp === owner);
  }, [pendingLiquidity, publicKey]);

  const userWithdrawals = useMemo(() => {
    if (!publicKey) return [];
    const owner = publicKey.toBase58();
    return withdrawals.filter((item) => item.lp === owner);
  }, [withdrawals, publicKey]);

  const userSlips = useMemo(() => {
    if (!publicKey) return [];
    const owner = publicKey.toBase58();
    return slips.filter((slip) => slip.creator === owner);
  }, [slips, publicKey]);

  return {
    markets,
    epochs,
    marketGroups,
    slips,
    orders,
    pendingLiquidity,
    withdrawals,
    epochVaults,
    epochLpPositions,
    userEpochPositions,
    userPendingLiquidity,
    userWithdrawals,
    userSlips,
    loading,
    error,
    refetch,
  };
}
