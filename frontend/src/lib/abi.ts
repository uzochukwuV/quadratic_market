import idl from "@/lib/idl.json";
import { frontendEnv } from "@/lib/env";

export const QUADRATIC_MARKET_IDL = {
  ...(idl as any),
  address: frontendEnv.programId,
};

export const QUADRATIC_MARKET_PROGRAM_ID = frontendEnv.programId;

export default QUADRATIC_MARKET_IDL;
