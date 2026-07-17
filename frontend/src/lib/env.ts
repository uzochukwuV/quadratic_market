const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM_ID = "FPaJasqbU2qULcJpbiGwduJix6dFRGK8JUefbXbSDcrN";
const DEFAULT_TXORACLE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
const DEFAULT_BASE_MINT = "8yqhLuiQRnvuU1RjDPM4kcRCcD1D5wPRfWdpG6dom3Vk";
const DEFAULT_TXLINE_API_ORIGIN = "https://txline-dev.txodds.com";
const DEFAULT_DONATION_WALLET = "9H1DCo5QaUtiMne4UH44aefHyv8Xpc8EgZwrshRZqsLC";

export const frontendEnv = {
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC_URL,
  programId: process.env.NEXT_PUBLIC_QUADRATIC_MARKET_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
  txoracleProgramId: process.env.NEXT_PUBLIC_TXORACLE_PROGRAM_ID ?? DEFAULT_TXORACLE_PROGRAM_ID,
  baseMint: process.env.NEXT_PUBLIC_BASE_MINT_ADDRESS ?? DEFAULT_BASE_MINT,
  txlineApiOrigin: process.env.NEXT_PUBLIC_TXLINE_API_ORIGIN ?? DEFAULT_TXLINE_API_ORIGIN,
  donationWallet: process.env.DONATION_WALLET_ADDRESS ?? DEFAULT_DONATION_WALLET,
};

export function getNetworkLabel(): string {
  if (frontendEnv.rpcUrl.includes("devnet")) return "Devnet";
  if (frontendEnv.rpcUrl.includes("mainnet")) return "Mainnet";
  return "Custom";
}
