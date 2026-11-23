import { Connection, PublicKey } from "@solana/web3.js";
import {
  JUPITER_PERPS_PROGRAM,
  JLP_POOL,
  JUP_SOL_CUSTODY,
  JUP_ETH_CUSTODY,
  JUP_BTC_CUSTODY,
  JUP_USDC_CUSTODY,
  CUSTODY_TO_SYMBOL,
  PACIFICA_API,
} from "./constants";

// ── Jupiter Perps: Position byte offsets (after 8-byte discriminator) ──
const POS_OWNER_OFFSET = 8;
const POS_CUSTODY_OFFSET = 72;
const POS_SIDE_OFFSET = 152;    // u8: 1=Long, 2=Short
const POS_PRICE_OFFSET = 153;   // u64, 6 decimals USD
const POS_SIZE_OFFSET = 161;    // u64, 6 decimals USD
const POS_COLLATERAL_OFFSET = 169; // u64, 6 decimals USD

const USD_DECIMALS = 1e6;

// ── Jupiter Perps: Read borrow rate from Custody account ──
// Custody layout has fundingRateState deep in the struct.
// We use the Pacifica API as primary funding rate source and Jupiter borrow rate as secondary.

export interface PerpPosition {
  platform: "Jupiter" | "Pacifica";
  symbol: string;
  side: "Long" | "Short";
  sizeUsd: number;       // USD
  collateralUsd: number; // USD
  entryPrice: number;    // USD
  leverage: number;
  owner: string;
}

/**
 * Fetch user's Jupiter Perps positions from mainnet
 */
export async function fetchJupiterPositions(
  wallet: PublicKey
): Promise<PerpPosition[]> {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Use getProgramAccounts with owner filter
  const accounts = await conn.getProgramAccounts(JUPITER_PERPS_PROGRAM, {
    filters: [
      { dataSize: 218 }, // Position account size
      { memcmp: { offset: POS_OWNER_OFFSET, bytes: wallet.toBase58() } },
    ],
  });

  const positions: PerpPosition[] = [];

  for (const { account } of accounts) {
    const data = account.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const sizeUsd = Number(view.getBigUint64(POS_SIZE_OFFSET, true));
    if (sizeUsd === 0) continue; // closed position

    const custodyBytes = data.slice(POS_CUSTODY_OFFSET, POS_CUSTODY_OFFSET + 32);
    const custodyKey = new PublicKey(custodyBytes).toBase58();
    const symbol = CUSTODY_TO_SYMBOL[custodyKey] ?? "UNKNOWN";

    const side = data[POS_SIDE_OFFSET] === 1 ? "Long" : "Short";
    const price = Number(view.getBigUint64(POS_PRICE_OFFSET, true)) / USD_DECIMALS;
    const size = sizeUsd / USD_DECIMALS;
    const collateral = Number(view.getBigUint64(POS_COLLATERAL_OFFSET, true)) / USD_DECIMALS;

    positions.push({
      platform: "Jupiter",
      symbol,
      side: side as "Long" | "Short",
      sizeUsd: size,
      collateralUsd: collateral,
      entryPrice: price,
      leverage: collateral > 0 ? Math.round((size / collateral) * 10) / 10 : 1,
      owner: wallet.toBase58(),
    });
  }

  return positions;
}

/**
 * Fetch user's Pacifica positions via REST API
 */
export async function fetchPacificaPositions(
  wallet: PublicKey
): Promise<PerpPosition[]> {
  try {
    const res = await fetch(`${PACIFICA_API}/positions?account=${wallet.toBase58()}`);
    if (!res.ok) return [];
    const data = await res.json();

    return (data ?? [])
      .filter((p: any) => p.amount && Number(p.amount) !== 0)
      .map((p: any) => {
        const symbol = (p.symbol ?? "").replace("-PERP", "");
        const size = Math.abs(Number(p.amount ?? 0) * Number(p.entry_price ?? 0));
        const collateral = Number(p.margin ?? 0);
        return {
          platform: "Pacifica" as const,
          symbol,
          side: (p.side === "bid" ? "Long" : "Short") as "Long" | "Short",
          sizeUsd: size,
          collateralUsd: collateral,
          entryPrice: Number(p.entry_price ?? 0),
          leverage: collateral > 0 ? Math.round((size / collateral) * 10) / 10 : 1,
          owner: wallet.toBase58(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Fetch funding rates from Pacifica REST API
 */
export async function fetchPacificaRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${PACIFICA_API}/info/prices`);
    if (!res.ok) return {};
    const json = await res.json();
    // Response: { success: true, data: [{ symbol: "SOL", funding: "0.0000125", ... }] }
    const items = json.data ?? json ?? [];

    const rates: Record<string, number> = {};
    for (const item of items) {
      const symbol = (item.symbol ?? "").replace("-PERP", "").replace("-USDC", "");
      // funding is a decimal string (e.g. "0.0000125" = 0.125 bps)
      const rate = Number(item.funding ?? 0) * 10000; // convert to bps
      if (symbol && rate !== 0) {
        rates[symbol] = rate;
      }
    }
    return rates;
  } catch {
    return {};
  }
}

// Generate mock funding rate history for chart display
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
