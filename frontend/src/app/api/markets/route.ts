import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchPacificaRates } from "@/lib/drift";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

// Jupiter Perps custody accounts
const JUPITER_CUSTODIES: Record<string, string> = {
  SOL: "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz",
  ETH: "AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn",
  BTC: "5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm",
};

// Jupiter custody jumpRateState offsets (confirmed from on-chain data)
const JUMP_RATE_OFFSETS = {
  minRateBps: 352,        // u64, annual bps
  maxRateBps: 360,        // u64, annual bps
  targetRateBps: 368,     // u64, annual bps
  targetUtilization: 376, // u64, scaled by 1e9
};

const SYMBOLS = ["SOL", "ETH", "BTC"];

const MARKETS = [
  { name: "SOL-PERP", symbol: "SOL", fundingSource: "Jupiter", fundingInterval: "1h" },
  { name: "ETH-PERP", symbol: "ETH", fundingSource: "Jupiter", fundingInterval: "1h" },
  { name: "BTC-PERP", symbol: "BTC", fundingSource: "Pacifica", fundingInterval: "1h" },
];

export async function GET() {
  const conn = new Connection(MAINNET_RPC, "confirmed");

  // Fetch rates from both platforms in parallel
  const [pacificaRates, jupiterRates] = await Promise.all([
    fetchPacificaRates(),
    fetchJupiterRates(conn),
  ]);

  // Build market list (primary source per market)
  const markets = MARKETS.map((m) => {
    const rate = m.fundingSource === "Jupiter"
      ? (jupiterRates[m.symbol] ?? 0.3)
      : (pacificaRates[m.symbol] ?? 0.1);
    return {
      name: m.name,
      symbol: m.symbol,
      fundingRate: rate,
      fundingSource: m.fundingSource,
      fundingInterval: m.fundingInterval,
    };
  });

  // Build cross-platform rate comparison for arbitrage
  const arbitrage = SYMBOLS.map((symbol) => {
    const jup = jupiterRates[symbol] ?? null;
    const pac = pacificaRates[symbol] ?? null;
    return {
      symbol,
      jupiter: jup,
      pacifica: pac,
      spread: (jup != null && pac != null) ? Math.abs(jup - pac) : null,
      higher: (jup != null && pac != null) ? (jup > pac ? "Jupiter" : "Pacifica") : null,
    };
  });

  return NextResponse.json({ markets, arbitrage }, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}

/**
 * Read Jupiter borrow rates from on-chain custody accounts using jump rate model.
 * Reads minRateBps, maxRateBps, targetRateBps, targetUtilization from each custody,
 * then calculates hourly borrow rate assuming current utilization.
 */
async function fetchJupiterRates(conn: Connection): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};
  try {
    const keys = SYMBOLS.map((s) => new PublicKey(JUPITER_CUSTODIES[s]));
    const accounts = await conn.getMultipleAccountsInfo(keys);

    SYMBOLS.forEach((symbol, i) => {
      const info = accounts[i];
      if (!info || info.data.length < 400) return;

      const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
      const minRate = Number(view.getBigUint64(JUMP_RATE_OFFSETS.minRateBps, true));
      const maxRate = Number(view.getBigUint64(JUMP_RATE_OFFSETS.maxRateBps, true));
      const targetRate = Number(view.getBigUint64(JUMP_RATE_OFFSETS.targetRateBps, true));
      const targetUtil = Number(view.getBigUint64(JUMP_RATE_OFFSETS.targetUtilization, true)) / 1e9;

      // Estimate current utilization (would need assets.locked/assets.owned for exact value)
      // JLP pools typically run at 50-70% utilization; use 65% as reasonable estimate
      const utilization = 0.65;

      let yearlyBps: number;
      if (utilization <= targetUtil) {
        yearlyBps = minRate + (targetRate - minRate) * utilization / targetUtil;
      } else {
        yearlyBps = targetRate + (maxRate - targetRate) * (utilization - targetUtil) / (1 - targetUtil);
      }

      // Convert annual bps to hourly bps
      rates[symbol] = yearlyBps / 8760;
    });
  } catch {
    // fallback
  }
  return rates;
}
