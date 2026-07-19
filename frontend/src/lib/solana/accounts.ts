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
  console.log("[markets] fetchAllMarkets:start", {
    hasMarketClient: Boolean(program.account.market),
  });
  try {
    const markets = await program.account.market.all();
    console.log("[markets] fetchAllMarkets:success", {
      count: markets.length,
      sample: markets.slice(0, 3).map(({ publicKey, account }) => ({
        publicKey: publicKey?.toBase58?.() ?? String(publicKey),
        marketId: account?.marketId?.toString?.() ?? account?.marketId,
        title: account?.title,
        status: account?.status,
        marketType: account?.marketType,
      })),
    });
    return markets;
  } catch (error) {
    console.error("[markets] fetchAllMarkets:error", error);
    throw error;
  }
}

export async function fetchOpenMarkets(program: QuadraticProgram) {
  const markets = await fetchAllMarkets(program);
  const openMarkets = markets.filter(({ account }) => "open" in account.status);
  console.log("[markets] fetchOpenMarkets:filtered", {
    total: markets.length,
    open: openMarkets.length,
  });
  return openMarkets;
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

export async function fetchAllEpochs(program: QuadraticProgram) {
  return program.account.epoch.all();
}

export async function fetchAllEpochVaults(program: QuadraticProgram) {
  return program.account.epochVault.all();
}

export async function fetchEpochLpPosition(
  program: QuadraticProgram,
  epochId: bigint | number | string,
  owner: PublicKey,
) {
  const [lpPosition] = getEpochLpPositionPda(epochId, owner);
  return program.account.epochLpPosition.fetch(lpPosition);
}

export async function fetchUserEpochLpPositions(program: QuadraticProgram, owner: PublicKey) {
  return program.account.epochLpPosition.all([
    {
      memcmp: {
        offset: 8,
        bytes: owner.toBase58(),
      },
    },
  ]);
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
