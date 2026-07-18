import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export function getAta(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve = false) {
  return getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve);
}
