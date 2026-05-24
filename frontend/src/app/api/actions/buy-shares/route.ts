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

  const MARKET_TITLES: Record<string, string> = {
    "m01": "BTC above $120K in 2026",
    "m02": "Argentina wins World Cup 2026",
    "m04": "SOL hits $1,000 in 2026",
    "market-001": "BTC above $120K in 2026",
  };

  const title = MARKET_TITLES[marketId] ?? `Market ${marketId}`;
  const isYes = outcome.toLowerCase() === "yes";
  const price = isYes ? "68¢" : "32¢";

  const response: ActionGetResponse = {
    type: "action",
    icon: `${new URL("/api/og/market", req.url).toString()}`,
    label: `Buy ${outcome.toUpperCase()} at ${price}`,
    title: `Trade: ${title}`,
    description: `Buy ${outcome.toUpperCase()} shares in "${title}". LMSR-priced, instant on-chain settlement. Current price: ${price}.`,
    links: {
      actions: [
        { type: "transaction", label: `Buy 10 ${outcome.toUpperCase()} (~$${isYes ? "6.80" : "3.20"})`, href: `/api/actions/buy-shares?market=${marketId}&outcome=${outcome}&shares=10` },
        { type: "transaction", label: `Buy 50 ${outcome.toUpperCase()} (~$${isYes ? "34" : "16"})`, href: `/api/actions/buy-shares?market=${marketId}&outcome=${outcome}&shares=50` },
        { type: "transaction", label: `Buy 100 ${outcome.toUpperCase()} (~$${isYes ? "68" : "32"})`, href: `/api/actions/buy-shares?market=${marketId}&outcome=${outcome}&shares=100` },
        {
          type: "transaction",
          href: `/api/actions/buy-shares?market=${marketId}&outcome=${outcome}&shares={shares}`,
          label: "Custom amount",
          parameters: [{ name: "shares", label: "Number of shares", type: "number" }],
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
    const costInSol = (shares * pricePerShare) / 1000;

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
          lamports: Math.max(1, Math.round(costInSol * LAMPORTS_PER_SOL)),
        }),
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const response: ActionPostResponse = {
      type: "transaction",
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      message: `Buying ${shares} ${outcome.toUpperCase()} shares — transaction ready to sign.`,
    };

    return Response.json(response, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const error: ActionError = { message };
    return new Response(JSON.stringify(error), { status: 500, headers });
  }
};
