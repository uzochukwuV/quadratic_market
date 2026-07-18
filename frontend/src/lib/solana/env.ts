import { PublicKey } from "@solana/web3.js";

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const QUADRATIC_MARKET_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_QUADRATIC_MARKET_PROGRAM_ID ??
    "FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN",
);

export const TXORACLE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TXORACLE_PROGRAM_ID ?? "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
);

export const BASE_MINT_ADDRESS = new PublicKey(
  process.env.NEXT_PUBLIC_BASE_MINT_ADDRESS ?? "8yqhLuiQRnvuU1RjDPM4kcRCcD1D5wPRfWdpG6dom3Vk",
);

export const TXLINE_API_ORIGIN = process.env.NEXT_PUBLIC_TXLINE_API_ORIGIN ?? "https://txline-dev.txodds.com";

export const BOT_API_ORIGIN = process.env.NEXT_PUBLIC_BOT_API_ORIGIN ?? "";
