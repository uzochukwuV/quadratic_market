"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  buyLegForSlip,
  cancelSlip,
  createMarket,
  optInEpochLiquidity,
  placeSlipAwait,
  resolveSlip,
  settleSlipLeg,
  updateMarketOdds,
  withdrawEpochLiquidity,
  type CreateMarketInput,
  type SlipLegInput,
} from "@/lib/solana/instructions";
import { useQuadraticProgram } from "./useQuadraticProgram";

type ActionState = {
  signature: string | null;
  loading: boolean;
  error: Error | null;
};

function useActionRunner() {
  const { publicKey } = useWallet();
  const program = useQuadraticProgram();
  const [state, setState] = useState<ActionState>({
    signature: null,
    loading: false,
    error: null,
  });

  async function run(action: () => Promise<string>) {
    if (!program || !publicKey) {
      throw new Error("Wallet is not connected.");
    }

    setState({ signature: null, loading: true, error: null });
    try {
      const signature = await action();
      setState({ signature, loading: false, error: null });
      return signature;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      setState({ signature: null, loading: false, error });
      throw error;
    }
  }

  return { program, publicKey, state, run };
}

export function usePlaceSlipAwait() {
  const { program, publicKey, state, run } = useActionRunner();

  return {
    ...state,
    placeSlip: (legs: SlipLegInput[], stake: bigint | number | string, cancelDeadline: bigint | number | string) =>
      run(() => placeSlipAwait(program!, publicKey!, legs, stake, cancelDeadline)),
  };
}

export function useBuyLegForSlip() {
  const { program, publicKey, state, run } = useActionRunner();

  return {
    ...state,
    buyLeg: (
      slipId: bigint | number | string,
      marketId: bigint | number | string,
      legIndex: number,
      outcomeId: number,
    ) => run(() => buyLegForSlip(program!, publicKey!, slipId, legIndex, marketId, outcomeId)),
  };
}

export function useSlipResolutionActions() {
  const { program, publicKey, state, run } = useActionRunner();

  return {
    ...state,
    cancelSlip: (slipId: bigint | number | string) => run(() => cancelSlip(program!, publicKey!, slipId)),
    settleLeg: (slipId: bigint | number | string, marketId: bigint | number | string, legIndex: number) =>
      run(() => settleSlipLeg(program!, publicKey!, slipId, legIndex, marketId)),
    resolveSlip: (slipId: bigint | number | string) => run(() => resolveSlip(program!, publicKey!, slipId)),
  };
}

export function useEpochLiquidityActions() {
  const { program, publicKey, state, run } = useActionRunner();

  return {
    ...state,
    deposit: (epochId: bigint | number | string, amount: bigint | number | string) =>
      run(() => optInEpochLiquidity(program!, publicKey!, epochId, amount)),
    withdraw: (epochId: bigint | number | string, shares: bigint | number | string) =>
      run(() => withdrawEpochLiquidity(program!, publicKey!, epochId, shares)),
  };
}

export function useMarketActions() {
  const { program, publicKey, state, run } = useActionRunner();

  return {
    ...state,
    createMarket: (input: CreateMarketInput) => run(() => createMarket(program!, publicKey!, input)),
    updateOdds: (marketId: bigint | number | string, odds: Array<bigint | number | string>) =>
      run(() => updateMarketOdds(program!, publicKey!, marketId, odds)),
  };
}
