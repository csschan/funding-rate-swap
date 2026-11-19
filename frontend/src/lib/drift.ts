import { Connection, PublicKey } from "@solana/web3.js";

// Drift PerpMarket on-chain byte offsets (from IDL struct layout analysis)
// PerpMarket disc(8) + pubkey(32) = 40 → AMM starts at offset 40
// AMM field 24: last_funding_rate (i64) at AMM offset 448 → global offset 488
// AMM field 25: last_funding_rate_long (i64) at global offset 496
// AMM field 26: last_funding_rate_short (i64) at global offset 504
// AMM field 50: last_funding_rate_ts (i64) at global offset 792
const LAST_FUNDING_RATE_OFFSET = 488;
const LAST_FUNDING_RATE_LONG_OFFSET = 496;
const LAST_FUNDING_RATE_SHORT_OFFSET = 504;
const LAST_FUNDING_RATE_TS_OFFSET = 792;

// Drift FUNDING_RATE_PRECISION = 1e9
const FUNDING_RATE_PRECISION = 1e9;

// Mainnet RPC for reading Drift data (funding rate display only)
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export interface DriftFundingData {
  fundingRate: number;        // bps per 8h
  fundingRateLong: number;    // bps per 8h (longs pay)
  fundingRateShort: number;   // bps per 8h (shorts pay)
  fundingRateTs: number;      // unix timestamp of last update
  fundingRateDailyBps: number;
  annualizedRate: number;     // APR %
}

export async function fetchDriftFundingRate(
  _connection: Connection, // unused, we use mainnet directly
  driftMarket: PublicKey
): Promise<DriftFundingData> {
  const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
  const info = await mainnetConn.getAccountInfo(driftMarket);
  if (!info) throw new Error("Drift market not found");

  const data = info.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const rawRate = Number(view.getBigInt64(LAST_FUNDING_RATE_OFFSET, true));
  const rawRateLong = Number(view.getBigInt64(LAST_FUNDING_RATE_LONG_OFFSET, true));
  const rawRateShort = Number(view.getBigInt64(LAST_FUNDING_RATE_SHORT_OFFSET, true));
  const fundingRateTs = Number(view.getBigInt64(LAST_FUNDING_RATE_TS_OFFSET, true));

  // Convert from FUNDING_RATE_PRECISION to bps
  const fundingRate = rawRate / FUNDING_RATE_PRECISION * 10000;
  const fundingRateLong = rawRateLong / FUNDING_RATE_PRECISION * 10000;
  const fundingRateShort = rawRateShort / FUNDING_RATE_PRECISION * 10000;

  return {
    fundingRate,
    fundingRateLong,
    fundingRateShort,
    fundingRateTs,
    fundingRateDailyBps: fundingRate * 3,
    annualizedRate: (fundingRate / 10000 * 100) * 3 * 365,
  };
}

// Generate mock funding rate history for chart display
// In production, this would fetch from a Drift historical API or indexer
export function generateMockHistory(currentRate: number, days = 30) {
  const data = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const ts = now - i * 86400_000;
    const noise = (Math.random() - 0.5) * Math.abs(currentRate) * 0.4;
    data.push({
      date: new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      rate: currentRate + noise,
      ts,
    });
  }
  return data;
}
