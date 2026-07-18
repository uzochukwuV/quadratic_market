import type { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getEpochLpPositionPda,
  getEpochPda,
  getEpochVaultPda,
  getGlobalConfigPda,
  getMarketGroupPda,
  getMarketPda,
  getOrderPda,
  getSlipPda,
} from "./pdas";

type AccountClient = {
  fetch: (address: PublicKey) => Promise<any>;
  all: (filters?: unknown[]) => Promise<any[]>;
};

export type QuadraticProgram = Program & {
  account: Record<string, AccountClient>;
};

export async function fetchGlobalConfig(program: QuadraticProgram) {
  const [globalConfig] = getGlobalConfigPda();
  return program.account.globalConfig.fetch(globalConfig);
}

export async function fetchMarket(program: QuadraticProgram, marketId: bigint | number | string) {
  const [market] = getMarketPda(marketId);
  return program.account.market.fetch(market);
}

export async function fetchAllMarkets(program: QuadraticProgram) {
  return program.account.market.all();
}

export async function fetchOpenMarkets(program: QuadraticProgram) {
  const markets = await fetchAllMarkets(program);
  return markets.filter(({ account }) => "open" in account.status);
}

export async function fetchSlip(program: QuadraticProgram, slipId: bigint | number | string) {
  const [slip] = getSlipPda(slipId);
  return program.account.slip.fetch(slip);
}

export async function fetchAllSlips(program: QuadraticProgram) {
  return program.account.slip.all();
}

export async function fetchUserSlips(program: QuadraticProgram, owner: PublicKey) {
  return program.account.slip.all([
    {
      memcmp: {
        offset: 8,
        bytes: owner.toBase58(),
      },
    },
  ]);
}

export async function fetchEpoch(program: QuadraticProgram, epochId: bigint | number | string) {
  const [epoch] = getEpochPda(epochId);
  return program.account.epoch.fetch(epoch);
}

export async function fetchEpochVault(program: QuadraticProgram, epochId: bigint | number | string) {
  const [epochVault] = getEpochVaultPda(epochId);
  return program.account.epochVault.fetch(epochVault);
}

export async function fetchEpochLpPosition(
  program: QuadraticProgram,
  epochId: bigint | number | string,
  owner: PublicKey,
) {
  const [lpPosition] = getEpochLpPositionPda(epochId, owner);
  return program.account.epochLpPosition.fetch(lpPosition);
}

export async function fetchMarketGroup(program: QuadraticProgram, groupId: bigint | number | string) {
  const [marketGroup] = getMarketGroupPda(groupId);
  return program.account.marketGroup.fetch(marketGroup);
}

export async function fetchAllMarketGroups(program: QuadraticProgram) {
  return program.account.marketGroup.all();
}

export async function fetchOrder(program: QuadraticProgram, orderId: bigint | number | string) {
  const [order] = getOrderPda(orderId);
  return program.account.limitOrder.fetch(order);
}
