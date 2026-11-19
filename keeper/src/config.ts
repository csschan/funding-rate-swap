import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

export const RPC_URL =
  process.env.RPC_URL || "https://api.devnet.solana.com";

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ||
    "EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC"
);

// SOL-PERP Drift market on devnet (placeholder — update with real address)
export const DRIFT_SOL_PERP_MARKET = new PublicKey(
  process.env.DRIFT_SOL_PERP_MARKET ||
    "8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W"
);

// USDC mint used for order/position vaults
export const USDC_MINT =
  process.env.USDC_MINT || "8RDUcZTDGpqWdDeSDRowwqAvgDjQq5eVop7M7CLr9sof";

// Settlement interval: 8 hours in ms
export const SETTLE_INTERVAL_MS = 8 * 60 * 60 * 1000;

// How often to scan for positions that need settling (poll interval)
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 60_000;

// Funding rate anomaly threshold (5% per 8h = 500 bps) — triggers circuit breaker
export const FUNDING_RATE_CIRCUIT_BREAKER_BPS = 500;

export function loadKeypair(keypairPath?: string): Keypair {
  const p =
    keypairPath ||
    process.env.KEEPER_KEYPAIR ||
    path.join(process.env.HOME || "~", ".config/solana/id.json");
  const raw = fs.readFileSync(p, "utf-8");
  return Keypair.fromSecretKey(Buffer.from(JSON.parse(raw)));
}
