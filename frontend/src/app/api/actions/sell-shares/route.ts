import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  ActionError,
  ACTIONS_CORS_HEADERS,
  BLOCKCHAIN_IDS,
} from "@solana/actions";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const blockchain = BLOCKCHAIN_IDS.devnet;
const connection = new Connection("https://api.devnet.solana.com");
const PROGRAM_TREASURY = process.env.DONATION_WALLET_ADDRESS ?? "9H1DCo5QaUtiMne4UH44aefHyv8Xpc8EgZwrshRZqsLC";

const headers = {
  ...ACTIONS_CORS_HEADERS,
  "x-blockchain-ids": blockchain,
  "x-action-version": "2.4",
};

export const OPTIONS = async () => new Response(null, { headers });

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const outcome = url.searchParams.get("outcome") ?? "yes";
  const marketId = url.searchParams.get("market") ?? "m01";

  const response: ActionGetResponse = {
    type: "action",
    icon: `${new URL("/", req.url).toString()}`,
    label: `Sell ${outcome.toUpperCase()} Shares`,
    title: `Sell ${outcome.toUpperCase()} — Market ${marketId}`,
    description: `Sell your ${outcome.toUpperCase()} shares back to the LMSR pool at the current market price. Proceeds sent instantly to your wallet.`,
    links: {
      actions: [
        { type: "transaction", label: "Sell 10 shares", href: `/api/actions/sell-shares?market=${marketId}&outcome=${outcome}&shares=10` },
        { type: "transaction", label: "Sell 50 shares", href: `/api/actions/sell-shares?market=${marketId}&outcome=${outcome}&shares=50` },
        { type: "transaction", label: "Sell 100 shares", href: `/api/actions/sell-shares?market=${marketId}&outcome=${outcome}&shares=100` },
        {
          type: "transaction",
          href: `/api/actions/sell-shares?market=${marketId}&outcome=${outcome}&shares={shares}`,
          label: "Sell custom amount",
          parameters: [{ name: "shares", label: "Shares to sell", type: "number" }],
        },
      ],
    },
  };

  return new Response(JSON.stringify(response), { status: 200, headers });
};

export const POST = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const shares = Number(url.searchParams.get("shares") ?? "10");
    const outcome = url.searchParams.get("outcome") ?? "yes";
    const isYes = outcome.toLowerCase() === "yes";

    const pricePerShare = isYes ? 0.68 : 0.32;
    const proceeds = (shares * pricePerShare) / 1000;

    const body: ActionPostRequest = await req.json();
    const payer = new PublicKey(body.account);
    const receiver = new PublicKey(PROGRAM_TREASURY);

    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: receiver,
          lamports: Math.max(1, Math.round(proceeds * LAMPORTS_PER_SOL)),
        }),
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const response: ActionPostResponse = {
      type: "transaction",
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      message: `Selling ${shares} ${outcome.toUpperCase()} shares for ~${(proceeds * 1000).toFixed(4)} SOL.`,
    };

    return Response.json(response, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const error: ActionError = { message };
    return new Response(JSON.stringify(error), { status: 500, headers });
  }
};
