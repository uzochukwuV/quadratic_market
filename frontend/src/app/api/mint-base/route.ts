import { NextResponse } from "next/server";

const BOT_API_ORIGIN = process.env.NEXT_PUBLIC_BOT_API_ORIGIN ?? "http://localhost:8787";
const BOT_API_KEY = process.env.BOT_API_KEY ?? "";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.recipient !== "string" || typeof body.amount !== "number") {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 422 });
  }

  const response = await fetch(`${BOT_API_ORIGIN}/api/mint-base`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(BOT_API_KEY ? { "X-API-Key": BOT_API_KEY } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  return NextResponse.json(payload ?? { detail: "Mint request failed" }, {
    status: response.status,
  });
}
