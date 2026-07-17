import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { SystemProgram, Transaction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { QuadraticMarket } from "../target/types/quadratic_market";

const PROGRAM_ID = new PublicKey("FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN");

function normalizeIdl(value: any): any {
  if (Array.isArray(value)) {
    return value.map(normalizeIdl);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, any> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "events") {
      continue;
    }

    if (key === "type" && inner === "publicKey") {
      out[key] = "pubkey";
      continue;
    }

    if (key === "defined" && typeof inner === "string") {
      out[key] = { name: inner };
      continue;
    }

    out[key] = normalizeIdl(inner);
  }
  return out;
}

function anchorDiscriminator(name: string): number[] {
  return Array.from(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
}

function camelToSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function snakeToCamel(value: any): any {
  if (Array.isArray(value)) {
    return value.map(snakeToCamel);
  }
  if (!value || typeof value !== "object" || value._bn) {
    return value;
  }
  const out: Record<string, any> = {};
  for (const [key, inner] of Object.entries(value)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = snakeToCamel(inner);
  }
  return out;
}

const anchorMethods = require("@coral-xyz/anchor/dist/cjs/program/namespace/methods.js");
const originalAccounts = anchorMethods.MethodsBuilder.prototype.accounts;
anchorMethods.MethodsBuilder.prototype.accounts = function (accounts: any) {
  return originalAccounts.call(this, snakeToCamel(accounts));
};
const originalAccountsPartial = anchorMethods.MethodsBuilder.prototype.accountsPartial;
anchorMethods.MethodsBuilder.prototype.accountsPartial = function (accounts: any) {
  return originalAccountsPartial.call(this, snakeToCamel(accounts));
};
const originalAccountsStrict = anchorMethods.MethodsBuilder.prototype.accountsStrict;
anchorMethods.MethodsBuilder.prototype.accountsStrict = function (accounts: any) {
  return originalAccountsStrict.call(this, snakeToCamel(accounts));
};

export function quadraticMarketProgram(provider: anchor.AnchorProvider): Program<QuadraticMarket> {
  const rawIdl = require("../target/idl/quadratic_market.json");
  const frontendIdl = require("../frontend/src/lib/idl.json");
  const idl = normalizeIdl(rawIdl);
  const frontendAccounts = new Map((frontendIdl.accounts ?? []).map((acc: any) => [acc.name, acc]));
  for (const account of idl.accounts ?? []) {
    const frontendAccount = frontendAccounts.get(account.name);
    if (frontendAccount?.discriminator && !account.discriminator) {
      account.discriminator = frontendAccount.discriminator;
    }
  }
  const existingTypes = new Set((idl.types ?? []).map((ty: any) => ty.name));
  for (const typeDef of frontendIdl.types ?? []) {
    if (!existingTypes.has(typeDef.name)) {
      (idl.types ??= []).push(normalizeIdl(typeDef));
    }
  }
  for (const ix of idl.instructions ?? []) {
    ix.discriminator = anchorDiscriminator(camelToSnake(ix.name));
  }
  idl.address = PROGRAM_ID.toString();
  return new Program(idl as anchor.Idl, provider) as Program<QuadraticMarket>;
}

export function encodeWithDiscriminator(
  program: Program<QuadraticMarket>,
  ixName: string,
  args: any,
  candidateNames: string[],
): Buffer {
  const encoded = Buffer.from(program.coder.instruction.encode(ixName, args));
  const body = encoded.subarray(8);
  for (const candidate of candidateNames) {
    const disc = Buffer.from(anchorDiscriminator(candidate));
    return Buffer.concat([disc, body]);
  }
  return encoded;
}

export async function sendCreateMarket(
  provider: anchor.AnchorProvider,
  program: Program<QuadraticMarket>,
  authority: anchor.web3.Keypair,
  globalConfigPda: PublicKey,
  marketPda: PublicKey,
  epochPda: PublicKey,
  startTime: anchor.BN,
  numOutcomes: number,
  title: string,
  description: string,
  category: number,
  marketType: any,
  initialOdds: anchor.BN[],
  txlineFixtureId: anchor.BN | null,
) {
  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: epochPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "createMarket",
      {
        startTime,
        numOutcomes,
        title,
        description,
        category,
        marketType,
        initialOdds,
        txlineFixtureId,
      },
      ["create_market"],
    ),
  });
  await provider.sendAndConfirm(new Transaction().add(ix), [authority]);
}

export async function sendInitOutcomeMint(
  provider: anchor.AnchorProvider,
  program: Program<QuadraticMarket>,
  payer: anchor.web3.Keypair,
  globalConfigPda: PublicKey,
  marketPda: PublicKey,
  outcomeMintPda: PublicKey,
  marketId: anchor.BN,
  outcomeId: number,
) {
  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: marketPda, isSigner: false, isWritable: true },
      { pubkey: outcomeMintPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "initOutcomeMint",
      {
        marketId,
        outcomeId,
      },
      ["init_outcome_mint"],
    ),
  });
  await provider.sendAndConfirm(new Transaction().add(ix), [payer]);
}

export async function sendOptInEpochLiquidity(
  provider: anchor.AnchorProvider,
  program: Program<QuadraticMarket>,
  lp: anchor.web3.Keypair,
  globalConfigPda: PublicKey,
  epochVaultPda: PublicKey,
  lpPositionPda: PublicKey,
  lpBaseAta: PublicKey,
  epochVaultBaseAta: PublicKey,
  epochId: anchor.BN,
  amount: anchor.BN,
) {
  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: epochVaultPda, isSigner: false, isWritable: true },
      { pubkey: lpPositionPda, isSigner: false, isWritable: true },
      { pubkey: lpBaseAta, isSigner: false, isWritable: true },
      { pubkey: epochVaultBaseAta, isSigner: false, isWritable: true },
      { pubkey: lp.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeWithDiscriminator(
      program,
      "optInEpochLiquidity",
      {
        epochId,
        amount,
      },
      ["opt_in_epoch_liquidity"],
    ),
  });
  await provider.sendAndConfirm(new Transaction().add(ix), [lp]);
}

export async function sendPlaceSlipAwait(
  provider: anchor.AnchorProvider,
  program: Program<QuadraticMarket>,
  owner: anchor.web3.Keypair,
  globalConfigPda: PublicKey,
  slipPda: PublicKey,
  treasuryPda: PublicKey,
  ownerBaseAta: PublicKey,
  treasuryBaseAta: PublicKey,
  baseMint: PublicKey,
  legs: Array<{ marketId: anchor.BN; outcomeId: number; numShares: anchor.BN }>,
  stake: anchor.BN,
  cancelDeadline: anchor.BN,
) {
  const ix = new anchor.web3.TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: slipPda, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: ownerBaseAta, isSigner: false, isWritable: true },
      { pubkey: treasuryBaseAta, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: program.coder.instruction.encode("placeSlipAwait", {
      legs,
      stake,
      cancelDeadline,
    }),
  });
  await provider.sendAndConfirm(new Transaction().add(ix), [owner]);
}
