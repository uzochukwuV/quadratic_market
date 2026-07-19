import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { BASE_MINT_ADDRESS, TXORACLE_PROGRAM_ID } from "./env";
import { fetchGlobalConfig, fetchMarket, fetchSlip } from "./accounts";
import {
  getEpochLpPositionPda,
  getEpochPda,
  getEpochVaultPda,
  getGlobalConfigPda,
  getMarketGroupPda,
  getMarketPda,
  getOutcomeMintPda,
  getSlipPda,
  getTreasuryPda,
} from "./pdas";

type MethodsNamespace = Record<
  string,
  (...args: unknown[]) => {
    accounts: (accounts: Record<string, PublicKey>) => { rpc: () => Promise<string> };
  }
>;

type QuadraticProgram = {
  methods: unknown;
  account: unknown;
};

export type U64Input = BN | bigint | number | string;

export type SlipLegInput = {
  marketId: U64Input;
  outcomeId: number;
  numShares: U64Input;
};

export type MarketTypeInput = "oneXTwo" | "overUnder" | "goalNoGoal";

export type CreateMarketInput = {
  startTime: U64Input;
  numOutcomes: number;
  title: string;
  description: string;
  category: number;
  marketType: MarketTypeInput;
  initialOdds: U64Input[];
  txlineFixtureId?: U64Input | null;
};

function bn(value: U64Input) {
  return BN.isBN(value) ? value : new BN(value.toString());
}

function optionBn(value: U64Input | null | undefined) {
  return value === null || value === undefined ? null : bn(value);
}

function methods(program: QuadraticProgram) {
  return program.methods as unknown as MethodsNamespace;
}

function marketType(value: MarketTypeInput) {
  return { [value]: {} };
}

async function baseAta(owner: PublicKey, allowOwnerOffCurve = false) {
  return getAssociatedTokenAddress(
    BASE_MINT_ADDRESS,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

async function outcomeAta(outcomeMint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddress(
    outcomeMint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

async function nextId(program: QuadraticProgram, key: "nextMarketId" | "nextSlipId" | "currentEpoch") {
  const config = (await fetchGlobalConfig(program as Parameters<typeof fetchGlobalConfig>[0])) as Record<string, U64Input>;
  return config[key];
}

export async function createMarket(program: QuadraticProgram, authority: PublicKey, input: CreateMarketInput) {
  const marketId = await nextId(program, "nextMarketId");
  const currentEpoch = await nextId(program, "currentEpoch");
  const [globalConfig] = getGlobalConfigPda();
  const [market] = getMarketPda(marketId);
  const [epoch] = getEpochPda(currentEpoch);

  return methods(program)
    .createMarket(
      bn(input.startTime),
      input.numOutcomes,
      input.title,
      input.description,
      input.category,
      marketType(input.marketType),
      input.initialOdds.map(bn),
      optionBn(input.txlineFixtureId),
    )
    .accounts({
      globalConfig,
      market,
      epoch,
      authority,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
}

export async function updateMarketOdds(
  program: QuadraticProgram,
  authority: PublicKey,
  marketId: U64Input,
  newOdds: U64Input[],
) {
  const [globalConfig] = getGlobalConfigPda();
  const [market] = getMarketPda(marketId);

  return methods(program)
    .updateMarketOdds(bn(marketId), newOdds.map(bn))
    .accounts({ globalConfig, market, authority })
    .rpc();
}

export async function updateMarketOddsWithProof(
  program: QuadraticProgram,
  authority: PublicKey,
  marketId: U64Input,
  newOdds: U64Input[],
  validationInput: unknown,
  strategy: unknown,
  dailyScoresMerkleRoots: PublicKey,
) {
  const [globalConfig] = getGlobalConfigPda();
  const [market] = getMarketPda(marketId);

  return methods(program)
    .updateMarketOddsWithProof(bn(marketId), newOdds.map(bn), validationInput, strategy)
    .accounts({
      globalConfig,
      market,
      dailyScoresMerkleRoots,
      txoracleProgram: TXORACLE_PROGRAM_ID,
      authority,
    })
    .rpc();
}

export async function createMarketGroup(
  program: QuadraticProgram,
  creator: PublicKey,
  groupId: U64Input,
  maxGroupExposure: U64Input,
  eventStartTime: U64Input,
  title: string,
) {
  const [globalConfig] = getGlobalConfigPda();
  const [marketGroup] = getMarketGroupPda(groupId);

  return methods(program)
    .createMarketGroup(bn(groupId), bn(maxGroupExposure), bn(eventStartTime), title)
    .accounts({ globalConfig, marketGroup, creator, systemProgram: SystemProgram.programId })
    .rpc();
}

export async function placeSlipAwait(
  program: QuadraticProgram,
  owner: PublicKey,
  legs: SlipLegInput[],
  stake: U64Input,
  cancelDeadline: U64Input,
) {
  const slipId = await nextId(program, "nextSlipId");
  const currentEpoch = await nextId(program, "currentEpoch");
  const [globalConfig] = getGlobalConfigPda();
  const [slip] = getSlipPda(slipId);
  const [epochVault] = getEpochVaultPda(currentEpoch);
  const ownerBaseAta = await baseAta(owner);
  const epochVaultBaseAta = await baseAta(epochVault, true);

  return methods(program)
    .placeSlipAwait(
      legs.map((leg) => ({
        marketId: bn(leg.marketId),
        outcomeId: leg.outcomeId,
        numShares: bn(leg.numShares),
      })),
      bn(stake),
      bn(cancelDeadline),
    )
    .accounts({
      globalConfig,
      slip,
      epochVault,
      ownerBaseAta,
      epochVaultBaseAta,
      baseMint: BASE_MINT_ADDRESS,
      owner,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function buyLegForSlip(
  program: QuadraticProgram,
  buyer: PublicKey,
  slipId: U64Input,
  legIndex: number,
  marketId: U64Input,
  outcomeId: number,
) {
  const [globalConfig] = getGlobalConfigPda();
  const [slip] = getSlipPda(slipId);
  const [market] = getMarketPda(marketId);
  const slipAccount = (await fetchSlip(program as Parameters<typeof fetchSlip>[0], slipId.toString())) as { epochId: { toString(): string } };
  const [epochVault] = getEpochVaultPda(slipAccount.epochId.toString());
  const [outcomeMint] = getOutcomeMintPda(marketId, outcomeId);
  const buyerOutcomeAta = await outcomeAta(outcomeMint, buyer);
  const epochVaultBaseAta = await baseAta(epochVault, true);

  return methods(program)
    .buyLegForSlip(bn(slipId), legIndex, outcomeId)
    .accounts({
      globalConfig,
      slip,
      market,
      epochVault,
      buyerOutcomeAta,
      epochVaultBaseAta,
      outcomeMint,
      baseMint: BASE_MINT_ADDRESS,
      buyer,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function cancelSlip(program: QuadraticProgram, owner: PublicKey, slipId: U64Input) {
  const [globalConfig] = getGlobalConfigPda();
  const [slip] = getSlipPda(slipId);
  const slipAccount = (await fetchSlip(program as Parameters<typeof fetchSlip>[0], slipId.toString())) as { epochId: { toString(): string } };
  const [epochVault] = getEpochVaultPda(slipAccount.epochId.toString());

  return methods(program)
    .cancelSlip(bn(slipId))
    .accounts({
      globalConfig,
      slip,
      epochVault,
      owner,
      cancellerBaseAta: await baseAta(owner),
      epochVaultBaseAta: await baseAta(epochVault, true),
      baseMint: BASE_MINT_ADDRESS,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function settleSlipLeg(program: QuadraticProgram, caller: PublicKey, slipId: U64Input, legIndex: number, marketId: U64Input) {
  const [globalConfig] = getGlobalConfigPda();
  const [slip] = getSlipPda(slipId);
  const [market] = getMarketPda(marketId);

  return methods(program).settleSlipLeg(bn(slipId), legIndex).accounts({ globalConfig, slip, market, caller }).rpc();
}

export async function resolveSlip(program: QuadraticProgram, owner: PublicKey, slipId: U64Input) {
  const [globalConfig] = getGlobalConfigPda();
  const [slip] = getSlipPda(slipId);
  const slipAccount = (await fetchSlip(program as Parameters<typeof fetchSlip>[0], slipId.toString())) as { epochId: { toString(): string } };
  const [epochVault] = getEpochVaultPda(slipAccount.epochId.toString());

  return methods(program)
    .resolveSlip(bn(slipId))
    .accounts({
      globalConfig,
      slip,
      epochVault,
      owner,
      claimerBaseAta: await baseAta(owner),
      epochVaultBaseAta: await baseAta(epochVault, true),
      baseMint: BASE_MINT_ADDRESS,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function initEpoch(program: QuadraticProgram, authority: PublicKey) {
  const currentEpoch = await nextId(program, "currentEpoch");
  const [globalConfig] = getGlobalConfigPda();
  const [epoch] = getEpochPda(currentEpoch);

  return methods(program)
    .initEpoch()
    .accounts({ globalConfig, epoch, authority, systemProgram: SystemProgram.programId })
    .rpc();
}

export async function optInEpochLiquidity(program: QuadraticProgram, lp: PublicKey, epochId: U64Input, amount: U64Input) {
  const [globalConfig] = getGlobalConfigPda();
  const [epochVault] = getEpochVaultPda(epochId);
  const [lpPosition] = getEpochLpPositionPda(epochId, lp);

  return methods(program)
    .optInEpochLiquidity(bn(epochId), bn(amount))
    .accounts({
      globalConfig,
      epochVault,
      lpPosition,
      lpBaseAta: await baseAta(lp),
      epochVaultBaseAta: await baseAta(epochVault, true),
      lp,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function withdrawEpochLiquidity(program: QuadraticProgram, lp: PublicKey, epochId: U64Input, shares: U64Input) {
  const [globalConfig] = getGlobalConfigPda();
  const [epochVault] = getEpochVaultPda(epochId);
  const [lpPosition] = getEpochLpPositionPda(epochId, lp);

  return methods(program)
    .withdrawEpochLiquidity(bn(epochId), bn(shares))
    .accounts({
      globalConfig,
      epochVault,
      lpPosition,
      lpBaseAta: await baseAta(lp),
      epochVaultBaseAta: await baseAta(epochVault, true),
      epochVaultAuthority: epochVault,
      lp,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function claimPayout(program: QuadraticProgram, claimer: PublicKey, marketId: U64Input, outcomeId?: number) {
  const marketAccount = (await fetchMarket(program as Parameters<typeof fetchMarket>[0], marketId.toString())) as {
    winningOutcome?: number;
  };
  const resolvedOutcome = outcomeId ?? marketAccount.winningOutcome ?? 0;
  const [globalConfig] = getGlobalConfigPda();
  const [market] = getMarketPda(marketId);
  const [treasury] = getTreasuryPda();
  const [outcomeMint] = getOutcomeMintPda(marketId, resolvedOutcome);

  return methods(program)
    .claimPayout(bn(marketId))
    .accounts({
      globalConfig,
      market,
      treasury,
      claimerOutcomeAta: await outcomeAta(outcomeMint, claimer),
      claimerBaseAta: await baseAta(claimer),
      treasuryBaseAta: await baseAta(treasury, true),
      outcomeMint,
      baseMint: BASE_MINT_ADDRESS,
      claimer,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}
