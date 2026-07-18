import { PublicKey } from "@solana/web3.js";
import { QUADRATIC_MARKET_PROGRAM_ID } from "./env";

const encoder = new TextEncoder();
type U64SeedInput = bigint | number | string | { toString: () => string };

export const PDA_SEEDS = {
  globalConfig: "global_config",
  treasury: "treasury",
  lpMint: "lp_mint",
  market: "market",
  outcomeMint: "outcome_mint",
  marketGroup: "market_group",
  order: "order",
  epoch: "epoch",
  epochVault: "epoch_vault",
  epochLp: "epoch_lp",
  slip: "slip",
} as const;

export function u64Seed(value: U64SeedInput) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value.toString()), true);
  return bytes;
}

export function u8Seed(value: number) {
  return Uint8Array.of(value);
}

export function findPda(seeds: Array<Uint8Array | string>, programId = QUADRATIC_MARKET_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    seeds.map((item) => (typeof item === "string" ? encoder.encode(item) : item)),
    programId,
  );
}

export function getGlobalConfigPda() {
  return findPda([PDA_SEEDS.globalConfig]);
}

export function getTreasuryPda() {
  return findPda([PDA_SEEDS.treasury]);
}

export function getLpMintPda() {
  return findPda([PDA_SEEDS.lpMint]);
}

export function getMarketPda(marketId: U64SeedInput) {
  return findPda([PDA_SEEDS.market, u64Seed(marketId)]);
}

export function getOutcomeMintPda(marketId: U64SeedInput, outcomeId: number) {
  return findPda([PDA_SEEDS.outcomeMint, u64Seed(marketId), u8Seed(outcomeId)]);
}

export function getMarketGroupPda(groupId: U64SeedInput) {
  return findPda([PDA_SEEDS.marketGroup, u64Seed(groupId)]);
}

export function getOrderPda(orderId: U64SeedInput) {
  return findPda([PDA_SEEDS.order, u64Seed(orderId)]);
}

export function getEpochPda(epochId: U64SeedInput) {
  return findPda([PDA_SEEDS.epoch, u64Seed(epochId)]);
}

export function getEpochVaultPda(epochId: U64SeedInput) {
  return findPda([PDA_SEEDS.epochVault, u64Seed(epochId)]);
}

export function getEpochLpPositionPda(epochId: U64SeedInput, lp: PublicKey) {
  return findPda([PDA_SEEDS.epochLp, u64Seed(epochId), lp.toBuffer()]);
}

export function getSlipPda(slipId: U64SeedInput) {
  return findPda([PDA_SEEDS.slip, u64Seed(slipId)]);
}
