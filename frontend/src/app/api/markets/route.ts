import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const FUNDING_RATE_PRECISION = 1e9;
const LAST_FUNDING_RATE_OFFSET = 488;

const MARKETS = [
  { name: "SOL-PERP", symbol: "SOL", driftMarket: "8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W" },
  { name: "ETH-PERP", symbol: "ETH", driftMarket: "Az8R7TSuMEMmXxpqGNnBPomDdHDcJSU2DYJbcbFkpGhR" },
  { name: "BTC-PERP", symbol: "BTC", driftMarket: "Fgh9JSZ2qfSjCw9RPJ85W2xbihsp2muLvfRztzoVR7f1" },
];

export async function GET() {
  const conn = new Connection(MAINNET_RPC, "confirmed");

  const results = await Promise.all(
    MARKETS.map(async (m) => {
      let fundingRate = 50; // default
      try {
        const info = await conn.getAccountInfo(new PublicKey(m.driftMarket));
        if (info) {
          const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
          const raw = Number(view.getBigInt64(LAST_FUNDING_RATE_OFFSET, true));
          fundingRate = (raw / FUNDING_RATE_PRECISION) * 10000;
        }
      } catch {
        // use default
      }
      return {
        name: m.name,
        symbol: m.symbol,
        fundingRate,
      };
    })
  );

  return NextResponse.json(results, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
