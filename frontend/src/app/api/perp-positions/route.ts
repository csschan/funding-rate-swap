import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { fetchJupiterPositions, fetchPacificaPositions } from "@/lib/drift";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }

  // Fetch from Jupiter (on-chain) and Pacifica (REST API) in parallel
  const [jupPositions, pacPositions] = await Promise.all([
    fetchJupiterPositions(pubkey).catch(() => []),
    fetchPacificaPositions(pubkey).catch(() => []),
  ]);

  return NextResponse.json([...jupPositions, ...pacPositions], {
    headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
  });
}
