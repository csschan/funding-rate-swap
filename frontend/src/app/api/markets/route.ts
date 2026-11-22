import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const FUNDING_RATE_PRECISION = 1e9;
const LAST_FUNDING_RATE_OFFSET = 488;

// Source-specific configs for reading on-chain funding rates
const FUNDING_SOURCES: Record<string, {
  rpc: string;
  offset: number;
  precision: number;
}> = {
  Drift: {
    rpc: MAINNET_RPC,
    offset: LAST_FUNDING_RATE_OFFSET,     // 488
    precision: FUNDING_RATE_PRECISION,     // 1e9
  },
  Jupiter: {
    rpc: MAINNET_RPC,
    offset: LAST_FUNDING_RATE_OFFSET,     // placeholder — update when Jupiter IDL is analyzed
    precision: FUNDING_RATE_PRECISION,
  },
  Binance: {
    rpc: MAINNET_RPC,                     // would use oracle/pyth in production
    offset: LAST_FUNDING_RATE_OFFSET,
    precision: FUNDING_RATE_PRECISION,
  },
};

const MARKETS = [
  { name: "SOL-PERP", symbol: "SOL", driftMarket: "8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W", fundingSource: "Drift", fundingInterval: "1h" },
  { name: "ETH-PERP", symbol: "ETH", driftMarket: "Az8R7TSuMEMmXxpqGNnBPomDdHDcJSU2DYJbcbFkpGhR", fundingSource: "Drift", fundingInterval: "1h" },
  { name: "BTC-PERP", symbol: "BTC", driftMarket: "Fgh9JSZ2qfSjCw9RPJ85W2xbihsp2muLvfRztzoVR7f1", fundingSource: "Jupiter", fundingInterval: "1h" },
];

export async function GET() {
  const results = await Promise.all(
    MARKETS.map(async (m) => {
      const src = FUNDING_SOURCES[m.fundingSource] ?? FUNDING_SOURCES.Drift;
      const conn = new Connection(src.rpc, "confirmed");
      let fundingRate = 50; // default
      try {
        const info = await conn.getAccountInfo(new PublicKey(m.driftMarket));
        if (info) {
          const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
          const raw = Number(view.getBigInt64(src.offset, true));
          fundingRate = (raw / src.precision) * 10000;
        }
      } catch {
        // use default
      }
      return {
        name: m.name,
        symbol: m.symbol,
        fundingRate,
        fundingSource: m.fundingSource,
        fundingInterval: m.fundingInterval,
      };
    })
  );

  return NextResponse.json(results, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
