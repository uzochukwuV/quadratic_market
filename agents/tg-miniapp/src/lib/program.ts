import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import { useMutation, useQuery } from "@tanstack/react-query";
import { IDL, type QuadraticMarketIDL } from "./idl";
import { PROGRAM_ID_STR, toOnChainAmount, fromOnChainAmount } from "./solana-config";
import { useWallet as _useWallet } from "@solana/wallet-adapter-react";

// ── Program ID ───────────────────────────────────────────────────────────────

let PROGRAM_ID: PublicKey;
try {
  PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
} catch {
  PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
}

export { PROGRAM_ID };

// ── PDA helpers ──────────────────────────────────────────────────────────────

export function getGlobalConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
}

export function getSlipPDA(slipId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("slip"), slipId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

export function getMarketPDA(marketId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

// ── Anchor program hook ──────────────────────────────────────────────────────

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(
      connection,
      // @ts-ignore – wallet-adapter satisfies the Wallet interface
      wallet,
      { commitment: "confirmed" }
    );
    return new Program(IDL as any, provider);
  }, [connection, wallet]);
}

// ── GlobalConfig query ───────────────────────────────────────────────────────

export interface GlobalConfigData {
  baseMint: PublicKey;
  treasury: PublicKey;
  nextSlipId: BN;
  paused: boolean;
}

export function useGlobalConfig() {
  const { connection } = useConnection();
  const program = useProgram();

  return useQuery<GlobalConfigData | null>({
    queryKey: ["globalConfig", PROGRAM_ID_STR],
    queryFn: async () => {
      if (!program) return null;
      const [gcPDA] = getGlobalConfigPDA();
      try {
        const gc = await (program.account as any).globalConfig.fetch(gcPDA);
        return gc as GlobalConfigData;
      } catch {
        return null;
      }
    },
    enabled: !!program,
    refetchInterval: 10_000,
  });
}

// ── On-chain Slip account type ───────────────────────────────────────────────

export interface OnChainSlip {
  publicKey: PublicKey;
  slipId: BN;
  owner: PublicKey;
  numLegs: number;
  legMarketIds: BN[];
  legOutcomeIds: number[];
  totalStake: BN;
  potentialPayout: BN;
  status: Record<string, object>;
  createdAt: BN;
  claimed: boolean;
}

export function slipStatusLabel(
  status: Record<string, object>
): "pending" | "active" | "won" | "lost" | "cancelled" {
  if ("pending" in status) return "pending";
  if ("active" in status) return "active";
  if ("won" in status) return "won";
  if ("lost" in status) return "lost";
  return "cancelled";
}

// ── Fetch on-chain slips for connected wallet ────────────────────────────────

export function useOnChainSlips() {
  const program = useProgram();
  const { publicKey } = useWallet();

  return useQuery<OnChainSlip[]>({
    queryKey: ["onChainSlips", publicKey?.toBase58()],
    queryFn: async (): Promise<OnChainSlip[]> => {
      if (!program || !publicKey) return [];

      // Filter by owner pubkey at offset 8 (after 8-byte discriminator)
      const accounts = await program.provider.connection.getProgramAccounts(
        PROGRAM_ID,
        {
          filters: [
            {
              memcmp: {
                offset: 8,
                bytes: publicKey.toBase58(),
              },
            },
          ],
        }
      );

      const slips: OnChainSlip[] = [];
      for (const { pubkey, account } of accounts) {
        try {
          const decoded = (program.coder as any).accounts.decode(
            "Slip",
            account.data
          );
          slips.push({ publicKey: pubkey, ...decoded });
        } catch {
          // skip accounts that fail to decode (not Slip accounts)
        }
      }

      return slips.sort((a, b) => b.createdAt.sub(a.createdAt).toNumber());
    },
    enabled: !!program && !!publicKey,
    refetchInterval: 15_000,
  });
}

// ── PlaceSlipAwait mutation ──────────────────────────────────────────────────

export interface PlaceSlipParams {
  marketId: number;    // on-chain market ID
  outcomeId: number;   // 0-based outcome index
  numShares: number;   // number of outcome shares
  stakeUi: number;     // stake in UI units (e.g. 0.5 SOL-equiv)
}

export function usePlaceSlipOnChain() {
  const program = useProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: globalConfig } = useGlobalConfig();

  return useMutation({
    mutationFn: async (params: PlaceSlipParams) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");
      if (!globalConfig) throw new Error("Global config not loaded");

      const { marketId, outcomeId, numShares, stakeUi } = params;
      const [gcPDA] = getGlobalConfigPDA();
      const slipId = globalConfig.nextSlipId;
      const [slipPDA] = getSlipPDA(slipId);

      const treasury = globalConfig.treasury;
      const baseMint = globalConfig.baseMint;
      const ownerBaseAta = getAssociatedTokenAddressSync(baseMint, publicKey);
      const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasury);

      const legs = [
        {
          marketId: new BN(marketId),
          outcomeId,
          numShares: new BN(numShares),
        },
      ];

      const stake = new BN(toOnChainAmount(stakeUi).toString());
      const cancelDeadline = new BN(Math.floor(Date.now() / 1000) + 120); // 2 min window

      const tx = await (program.methods as any)
        .placeSlipAwait(legs, stake, cancelDeadline)
        .accounts({
          globalConfig: gcPDA,
          slip: slipPDA,
          treasury,
          ownerBaseAta,
          treasuryBaseAta,
          baseMint,
          owner: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      return { signature: sig, slipId: slipId.toString() };
    },
  });
}

// ── ResolveSlip mutation ─────────────────────────────────────────────────────

export function useResolveSlip() {
  const program = useProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { data: globalConfig } = useGlobalConfig();

  return useMutation({
    mutationFn: async (slipId: BN) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");
      if (!globalConfig) throw new Error("Global config not loaded");

      const [gcPDA] = getGlobalConfigPDA();
      const [slipPDA] = getSlipPDA(slipId);
      const treasury = globalConfig.treasury;
      const baseMint = globalConfig.baseMint;
      const claimerBaseAta = getAssociatedTokenAddressSync(baseMint, publicKey);
      const treasuryBaseAta = getAssociatedTokenAddressSync(baseMint, treasury);

      const tx = await (program.methods as any)
        .resolveSlip(slipId)
        .accounts({
          globalConfig: gcPDA,
          slip: slipPDA,
          treasury,
          owner: publicKey,
          claimerBaseAta,
          treasuryBaseAta,
          baseMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      return { signature: sig };
    },
  });
}
