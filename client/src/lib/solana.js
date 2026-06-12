/**
 * solana.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Transaction builder for the Quadratic Market protocol.
 *
 * Browser-safe — uses Uint8Array / DataView everywhere instead of Node.js Buffer.
 * Uses @solana/web3-compat (re-exports @solana/web3.js PublicKey, Transaction,
 * TransactionInstruction) so transactions are compatible with Phantom's
 * window.solana.signAllTransactions API.
 *
 * Main exports:
 *   buildSlipTransactions(config, walletPubkey, legs, maxPayment)
 *   buildCancelSlipTransaction(config, walletPubkey, slipId)
 *   buildClaimSlipTransaction(config, walletPubkey, slipId, numGroups)
 *   sendAndConfirmAll(rpcUrl, signedTxs)
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3-compat';

// ─── Program constants ────────────────────────────────────────────────────────

const TOKEN_PROGRAM_ID  = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ─── Browser-safe byte helpers ────────────────────────────────────────────────

/** Convert a string to a Uint8Array (UTF-8) */
function strToBytes(s) {
  return new TextEncoder().encode(s);
}

/** Write a u64 as 8 bytes little-endian (Uint8Array) */
function u64LE(value) {
  const arr = new Uint8Array(8);
  const dv  = new DataView(arr.buffer);
  const n   = typeof value === 'bigint' ? value : BigInt(Math.floor(Number(value)));
  dv.setBigUint64(0, n, /* littleEndian */ true);
  return arr;
}

/** Single byte Uint8Array */
function u8(value) {
  return new Uint8Array([value & 0xff]);
}

/** Concatenate multiple Uint8Array / number-array values into one Uint8Array */
function concat(...parts) {
  const arrays = parts.map((p) =>
    p instanceof Uint8Array ? p : new Uint8Array(p)
  );
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ─── Discriminators (from IDL) ────────────────────────────────────────────────

const DISC = {
  open_slip:     new Uint8Array([234, 150, 162,  89, 190, 253, 233,  61]),
  add_slip_leg:  new Uint8Array([129, 155,  57, 124, 168, 231, 116,  23]),
  finalize_slip: new Uint8Array([ 28, 107,  74, 162,  62,  73, 226,   0]),
  cancel_slip:   new Uint8Array([169, 107,  81,  11, 186, 195,  81, 117]),
  claim_slip:    new Uint8Array([ 18,  53, 162,  90, 184, 165, 254, 188]),
};

// ─── PDA helpers ─────────────────────────────────────────────────────────────

export function pdaSync(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId));
}

function globalConfigPDA(programId) {
  return pdaSync([strToBytes('global_config')], programId)[0];
}

function marketPDA(programId, marketId) {
  return pdaSync([strToBytes('market'), u64LE(marketId)], programId)[0];
}

function outcomeMintPDA(programId, marketId, outcomeId) {
  return pdaSync(
    [strToBytes('outcome_mint'), u64LE(marketId), u8(outcomeId)],
    programId
  )[0];
}

function betSlipPDA(programId, slipId) {
  return pdaSync([strToBytes('bet_slip'), u64LE(slipId)], programId)[0];
}

/**
 * Derive an Associated Token Account (ATA) address without the spl-token package.
 * ATA = PDA([owner, TOKEN_PROGRAM_ID, mint], ATOKEN_PROGRAM_ID)
 */
function getAssociatedTokenAddress(ownerPubkeyStr, mintPubkeyStr) {
  const owner = new PublicKey(ownerPubkeyStr);
  const mint  = new PublicKey(mintPubkeyStr);
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ATOKEN_PROGRAM_ID
  )[0];
}

// ─── Instruction builders ─────────────────────────────────────────────────────

/**
 * open_slip(slip_id: u64, num_legs: u8, max_payment: u64)
 */
function buildOpenSlip({ programId, slipId, numLegs, maxPayment, slipCreator }) {
  const data = concat(DISC.open_slip, u64LE(slipId), u8(numLegs), u64LE(maxPayment));

  const pid      = new PublicKey(programId);
  const gcPda    = globalConfigPDA(programId);
  const slipPda  = betSlipPDA(programId, slipId);
  const creator  = new PublicKey(slipCreator);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: gcPda,                  isSigner: false, isWritable: true  },
      { pubkey: slipPda,                isSigner: false, isWritable: true  },
      { pubkey: creator,                isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId,isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * add_slip_leg(slip_id: u64, leg: SlipLeg { market_id(u64) + outcome_id(u8) + num_shares(u64) })
 */
function buildAddSlipLeg({
  programId, slipId, slipCreator, baseMint,
  treasury, treasuryBaseAta, leg,
}) {
  const { marketId, outcomeId, numShares } = leg;

  // SlipLeg borsh layout: market_id(u64) + outcome_id(u8) + num_shares(u64)
  const legBytes = concat(u64LE(marketId), u8(outcomeId), u64LE(numShares));
  const data     = concat(DISC.add_slip_leg, u64LE(slipId), legBytes);

  const pid         = new PublicKey(programId);
  const gcPda       = globalConfigPDA(programId);
  const slipPda     = betSlipPDA(programId, slipId);
  const mktPda      = marketPDA(programId, marketId);
  const omPda       = outcomeMintPDA(programId, marketId, outcomeId);
  const creator     = new PublicKey(slipCreator);
  const buyerBase   = getAssociatedTokenAddress(slipCreator, baseMint);
  // slip_outcome_ata = ATA(slip_pda, outcome_mint) — slip PDA is the owner
  const slipOutcome = getAssociatedTokenAddress(slipPda.toBase58(), omPda.toBase58());

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: gcPda,                           isSigner: false, isWritable: true  },
      { pubkey: slipPda,                         isSigner: false, isWritable: true  },
      { pubkey: mktPda,                          isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasury),         isSigner: false, isWritable: false },
      { pubkey: buyerBase,                       isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasuryBaseAta),  isSigner: false, isWritable: true  },
      { pubkey: omPda,                           isSigner: false, isWritable: true  },
      { pubkey: slipOutcome,                     isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(baseMint),         isSigner: false, isWritable: false },
      { pubkey: creator,                         isSigner: true,  isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
      { pubkey: ATOKEN_PROGRAM_ID,               isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * finalize_slip(slip_id: u64)
 */
function buildFinalizeSlip({ programId, slipId, slipCreator, baseMint, treasury, treasuryBaseAta }) {
  const data = concat(DISC.finalize_slip, u64LE(slipId));

  const pid    = new PublicKey(programId);
  const gcPda  = globalConfigPDA(programId);
  const slipPda= betSlipPDA(programId, slipId);
  const creator= new PublicKey(slipCreator);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: gcPda,                           isSigner: false, isWritable: true  },
      { pubkey: slipPda,                         isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasury),         isSigner: false, isWritable: false },
      { pubkey: new PublicKey(treasuryBaseAta),  isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(baseMint),         isSigner: false, isWritable: false },
      { pubkey: creator,                         isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * cancel_slip(slip_id: u64)
 */
function buildCancelSlip({ programId, slipId, slipCreator, baseMint, treasury, treasuryBaseAta }) {
  const data    = concat(DISC.cancel_slip, u64LE(slipId));
  const pid     = new PublicKey(programId);
  const gcPda   = globalConfigPDA(programId);
  const slipPda = betSlipPDA(programId, slipId);
  const creator = new PublicKey(slipCreator);
  const buyerBase = getAssociatedTokenAddress(slipCreator, baseMint);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: gcPda,                           isSigner: false, isWritable: true  },
      { pubkey: slipPda,                         isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasury),         isSigner: false, isWritable: false },
      { pubkey: new PublicKey(treasuryBaseAta),  isSigner: false, isWritable: true  },
      { pubkey: buyerBase,                       isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(baseMint),         isSigner: false, isWritable: false },
      { pubkey: creator,                         isSigner: true,  isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * claim_slip(slip_id: u64, num_groups: u8)
 */
function buildClaimSlip({ programId, slipId, claimer, baseMint, treasury, treasuryBaseAta, numGroups = 0 }) {
  const data      = concat(DISC.claim_slip, u64LE(slipId), u8(numGroups));
  const pid       = new PublicKey(programId);
  const gcPda     = globalConfigPDA(programId);
  const slipPda   = betSlipPDA(programId, slipId);
  const claimerPk = new PublicKey(claimer);
  const claimerBase = getAssociatedTokenAddress(claimer, baseMint);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: gcPda,                           isSigner: false, isWritable: true  },
      { pubkey: slipPda,                         isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasury),         isSigner: false, isWritable: false },
      { pubkey: claimerBase,                     isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(treasuryBaseAta),  isSigner: false, isWritable: true  },
      { pubkey: new PublicKey(baseMint),         isSigner: false, isWritable: false },
      { pubkey: claimerPk,                       isSigner: true,  isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────

async function getRecentBlockhash(rpcUrl) {
  const res  = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`getLatestBlockhash: ${JSON.stringify(json.error)}`);
  return json.result.value.blockhash;
}

async function confirmTransaction(rpcUrl, signature, maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    const res  = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method:  'getSignatureStatuses',
        params:  [[signature], { searchTransactionHistory: false }],
      }),
    });
    const json   = await res.json();
    const status = json.result?.value?.[0];
    if (status) {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Transaction ${signature} timed out waiting for confirmation`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build all transactions for a multi-leg slip and return them ready for
 * window.solana.signAllTransactions (one Phantom prompt).
 *
 * Flow:  open_slip  →  add_slip_leg × N  →  finalize_slip
 *
 * @param {object} config       - from GET /protocol_config
 * @param {string} walletPubkey - user's base58 public key
 * @param {Array}  legs         - [{ marketId, outcomeId, numShares }]
 * @param {number} maxPayment   - lamports, slippage-inclusive max USDC cost
 * @returns {Transaction[]}     ready for signAllTransactions
 */
export async function buildSlipTransactions(config, walletPubkey, legs, maxPayment) {
  const {
    program_id:        programId,
    treasury,
    treasury_base_ata: treasuryBaseAta,
    base_mint:         baseMint,
    rpc_url:           rpcUrl,
    next_slip_id:      slipId,
  } = config;

  if (!legs?.length)    throw new Error('No legs provided');
  if (!walletPubkey)    throw new Error('Wallet not connected');

  const blockhash = await getRecentBlockhash(rpcUrl);
  const feePayer  = new PublicKey(walletPubkey);
  const txOpts    = { recentBlockhash: blockhash, feePayer };

  // 1. open_slip
  const openTx = new Transaction(txOpts);
  openTx.add(buildOpenSlip({ programId, slipId, numLegs: legs.length, maxPayment, slipCreator: walletPubkey }));

  // 2. add_slip_leg × N  (one tx per leg to avoid heap exhaustion on-chain)
  const legTxs = legs.map((leg) => {
    const tx = new Transaction({ ...txOpts });
    tx.add(buildAddSlipLeg({ programId, slipId, slipCreator: walletPubkey, baseMint, treasury, treasuryBaseAta, leg }));
    return tx;
  });

  // 3. finalize_slip
  const finalizeTx = new Transaction(txOpts);
  finalizeTx.add(buildFinalizeSlip({ programId, slipId, slipCreator: walletPubkey, baseMint, treasury, treasuryBaseAta }));

  return [openTx, ...legTxs, finalizeTx];
}

/**
 * Build a cancel_slip transaction.
 */
export async function buildCancelSlipTransaction(config, walletPubkey, slipId) {
  const { program_id: programId, treasury, treasury_base_ata: treasuryBaseAta, base_mint: baseMint, rpc_url: rpcUrl } = config;
  const blockhash = await getRecentBlockhash(rpcUrl);
  const feePayer  = new PublicKey(walletPubkey);
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer });
  tx.add(buildCancelSlip({ programId, slipId, slipCreator: walletPubkey, baseMint, treasury, treasuryBaseAta }));
  return tx;
}

/**
 * Build a claim_slip transaction.
 */
export async function buildClaimSlipTransaction(config, walletPubkey, slipId, numGroups = 0) {
  const { program_id: programId, treasury, treasury_base_ata: treasuryBaseAta, base_mint: baseMint, rpc_url: rpcUrl } = config;
  const blockhash = await getRecentBlockhash(rpcUrl);
  const feePayer  = new PublicKey(walletPubkey);
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer });
  tx.add(buildClaimSlip({ programId, slipId, claimer: walletPubkey, baseMint, treasury, treasuryBaseAta, numGroups }));
  return tx;
}

/**
 * Send signed transactions sequentially and wait for each to be confirmed.
 *
 * @param {string}        rpcUrl    - Solana RPC endpoint
 * @param {Transaction[]} signedTxs - Fully-signed legacy transactions
 * @returns {string[]} confirmed signatures
 */
export async function sendAndConfirmAll(rpcUrl, signedTxs) {
  const signatures = [];
  for (const tx of signedTxs) {
    // @solana/web3.js Transaction.serialize() returns a Buffer subclass;
    // btoa() needs a binary string — use Uint8Array view + base64 encoding
    const bytes      = tx.serialize();
    const uint8      = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const base64     = btoa(String.fromCharCode(...uint8));

    const res  = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method:  'sendTransaction',
        params:  [base64, { encoding: 'base64', preflightCommitment: 'confirmed' }],
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`sendTransaction failed: ${JSON.stringify(json.error)}`);
    const sig = json.result;
    signatures.push(sig);
    await confirmTransaction(rpcUrl, sig);
  }
  return signatures;
}
