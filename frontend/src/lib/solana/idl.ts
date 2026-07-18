import type { Idl } from "@coral-xyz/anchor";
import quadraticMarketIdl from "@/idl/quadratic_market.json";

export const quadraticMarketIdlJson = quadraticMarketIdl as unknown as Idl;

export type QuadraticMarketIdl = typeof quadraticMarketIdl;
