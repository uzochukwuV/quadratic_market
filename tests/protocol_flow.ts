import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const idlPath = path.resolve(__dirname, "../target/idl/quadratic_market.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;

export const quadraticMarket = new Program(
  idl,
  anchor.AnchorProvider.env()
);
