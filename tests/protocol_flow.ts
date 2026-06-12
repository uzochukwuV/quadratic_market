import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { loadIdl } from "../lifecycle/common";

const idl = loadIdl();

export const quadraticMarket = new Program(
  idl,
  anchor.AnchorProvider.env()
);
