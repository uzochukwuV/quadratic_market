"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useProgram } from "@/hooks/useContract";
import {
  normalizeEpoch,
  normalizeEpochLpPosition,
  normalizeEpochVault,
  normalizeMarket,
  normalizeMarketGroup,
  normalizeOrder,
  normalizePendingLiquidity,
  normalizeSlip,
  normalizeWithdrawalRequest,
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

type AnchorAccountEntry<T> = {
  publicKey: PublicKey;
  account: T;
};

async function fetchAll<T>(loader: Promise<AnchorAccountEntry<T>[]>) {
  const rows = await loader;
  return rows.map((row, index) => ({ ...row, index }));
}

export function useProtocol() {
  const { program } = useProgram();
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
      if (!program) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const [
          rawMarkets,
          rawEpochs,
          rawMarketGroups,
          rawSlips,
          rawOrders,
          rawPending,
          rawWithdrawals,
          rawEpochVaults,
          rawEpochLpPositions,
        ] = await Promise.all([
          fetchAll(program.account.market.all()),
          fetchAll(program.account.epoch.all()),
          fetchAll(program.account.marketGroup.all()),
          fetchAll(program.account.slip.all()),
          fetchAll(program.account.limitOrder.all()),
          fetchAll(program.account.pendingLiquidity.all()),
          fetchAll(program.account.withdrawalRequest.all()),
          fetchAll(program.account.epochVault.all()),
          fetchAll(program.account.epochLpPosition.all()),
        ]);

        if (cancelled) return;

        setMarkets(rawMarkets.map((item, index) => normalizeMarket(item.account, index)));
        setEpochs(rawEpochs.map((item, index) => normalizeEpoch(item.account, index)));
        setMarketGroups(rawMarketGroups.map((item) => normalizeMarketGroup(item.account)));
        setSlips(rawSlips.map((item, index) => normalizeSlip(item.account, index)));
        setOrders(rawOrders.map((item, index) => normalizeOrder(item.account, index)));
        setPendingLiquidity(rawPending.map((item) => normalizePendingLiquidity(item.account)));
        setWithdrawals(rawWithdrawals.map((item) => normalizeWithdrawalRequest(item.account)));
        setEpochVaults(rawEpochVaults.map((item) => normalizeEpochVault(item.account)));
        setEpochLpPositions(rawEpochLpPositions.map((item) => normalizeEpochLpPosition(item.account)));
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
  }, [program, refreshIndex]);

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
