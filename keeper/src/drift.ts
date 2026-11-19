import { Connection, PublicKey } from "@solana/web3.js";

// Byte offsets in Drift PerpMarket account for the fields we need.
// Source: drift-protocol/protocol-v2 PerpMarket struct layout.
// amm.last_funding_rate: i64 at offset 278
// amm.last_funding_rate_ts: i64 at offset 286
const FUNDING_RATE_OFFSET = 278;
const FUNDING_RATE_TS_OFFSET = 286;

export interface FundingRateData {
  lastFundingRate: bigint;  // basis points per 8h, as stored by Drift
  lastFundingRateTs: bigint; // unix timestamp
}

export async function readDriftFundingRate(
  connection: Connection,
  driftPerpMarket: PublicKey
): Promise<FundingRateData> {
  const accountInfo = await connection.getAccountInfo(driftPerpMarket);
  if (!accountInfo) {
    throw new Error(`Drift PerpMarket account not found: ${driftPerpMarket}`);
  }

  const data = accountInfo.data;
  if (data.length < FUNDING_RATE_TS_OFFSET + 8) {
    throw new Error("Drift PerpMarket account data too short");
  }

  const lastFundingRate = data.readBigInt64LE(FUNDING_RATE_OFFSET);
  const lastFundingRateTs = data.readBigInt64LE(FUNDING_RATE_TS_OFFSET);

  return { lastFundingRate, lastFundingRateTs };
}

export function subscribeToFundingRateChanges(
  connection: Connection,
  driftPerpMarket: PublicKey,
  onUpdate: (data: FundingRateData) => void
): number {
  return connection.onAccountChange(driftPerpMarket, (accountInfo) => {
    const data = accountInfo.data;
    if (data.length < FUNDING_RATE_TS_OFFSET + 8) return;

    const lastFundingRate = data.readBigInt64LE(FUNDING_RATE_OFFSET);
    const lastFundingRateTs = data.readBigInt64LE(FUNDING_RATE_TS_OFFSET);
    onUpdate({ lastFundingRate, lastFundingRateTs });
  });
}
