import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC"
);

export const DRIFT_SOL_PERP_MARKET = new PublicKey(
  "8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W"
);

export const USDC_MINT_DEVNET = new PublicKey(
  "8RDUcZTDGpqWdDeSDRowwqAvgDjQq5eVop7M7CLr9sof"
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export const DRIFT_ETH_PERP_MARKET = new PublicKey(
  "Az8R7TSuMEMmXxpqGNnBPomDdHDcJSU2DYJbcbFkpGhR"
);

export const DRIFT_BTC_PERP_MARKET = new PublicKey(
  "Fgh9JSZ2qfSjCw9RPJ85W2xbihsp2muLvfRztzoVR7f1"
);

export type FundingSource = "Drift" | "Jupiter" | "Binance";

export interface MarketConfig {
  name: string;
  symbol: string;
  driftMarket: PublicKey;
  fundingSource: FundingSource;
  fundingInterval: string; // e.g. "1h", "8h"
  comingSoon: boolean;
}

export const MARKETS: MarketConfig[] = [
  {
    name: "SOL-PERP",
    symbol: "SOL",
    driftMarket: DRIFT_SOL_PERP_MARKET,
    fundingSource: "Drift",
    fundingInterval: "1h",
    comingSoon: false,
  },
  {
    name: "ETH-PERP",
    symbol: "ETH",
    driftMarket: DRIFT_ETH_PERP_MARKET,
    fundingSource: "Drift",
    fundingInterval: "1h",
    comingSoon: true,
  },
  {
    name: "BTC-PERP",
    symbol: "BTC",
    driftMarket: DRIFT_BTC_PERP_MARKET,
    fundingSource: "Jupiter",
    fundingInterval: "1h",
    comingSoon: true,
  },
];

// Minimum contract duration options (in 8h periods)
export const DURATION_OPTIONS = [
  { label: "7 days", periods: 21 },
  { label: "14 days", periods: 42 },
  { label: "30 days", periods: 90 },
];

export const BPS_PER_PERIOD = 10_000; // divisor for rate calculations
