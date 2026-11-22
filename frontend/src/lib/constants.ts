import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC"
);

export const USDC_MINT_DEVNET = new PublicKey(
  "8RDUcZTDGpqWdDeSDRowwqAvgDjQq5eVop7M7CLr9sof"
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

// ── On-chain swap market PDA seeds (legacy — used to derive swap market PDAs) ──
export const SWAP_MARKET_SEEDS: Record<string, PublicKey> = {
  SOL: new PublicKey("8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W"),
  ETH: new PublicKey("Az8R7TSuMEMmXxpqGNnBPomDdHDcJSU2DYJbcbFkpGhR"),
  BTC: new PublicKey("Fgh9JSZ2qfSjCw9RPJ85W2xbihsp2muLvfRztzoVR7f1"),
};

// ── Jupiter Perpetuals ──
export const JUPITER_PERPS_PROGRAM = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
);
export const JLP_POOL = new PublicKey(
  "5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq"
);
// Jupiter custody accounts (determines market)
export const JUP_SOL_CUSTODY = new PublicKey(
  "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz"
);
export const JUP_ETH_CUSTODY = new PublicKey(
  "AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn"
);
export const JUP_BTC_CUSTODY = new PublicKey(
  "5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm"
);
export const JUP_USDC_CUSTODY = new PublicKey(
  "G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa"
);

// Map custody → symbol
export const CUSTODY_TO_SYMBOL: Record<string, string> = {
  [JUP_SOL_CUSTODY.toBase58()]: "SOL",
  [JUP_ETH_CUSTODY.toBase58()]: "ETH",
  [JUP_BTC_CUSTODY.toBase58()]: "BTC",
};

// ── Pacifica ──
export const PACIFICA_API = "https://api.pacifica.fi/api/v1";

// ── Funding Sources ──
export type FundingSource = "Jupiter" | "Pacifica";

export interface MarketConfig {
  name: string;
  symbol: string;
  fundingSource: FundingSource;
  fundingInterval: string; // "1h"
  custody?: PublicKey;     // Jupiter custody address (for on-chain reads)
  comingSoon: boolean;
}

export const MARKETS: MarketConfig[] = [
  {
    name: "SOL-PERP",
    symbol: "SOL",
    fundingSource: "Jupiter",
    fundingInterval: "1h",
    custody: JUP_SOL_CUSTODY,
    comingSoon: false,
  },
  {
    name: "ETH-PERP",
    symbol: "ETH",
    fundingSource: "Jupiter",
    fundingInterval: "1h",
    custody: JUP_ETH_CUSTODY,
    comingSoon: true,
  },
  {
    name: "BTC-PERP",
    symbol: "BTC",
    fundingSource: "Pacifica",
    fundingInterval: "1h",
    comingSoon: true,
  },
];

// Minimum contract duration options (in funding periods)
export const DURATION_OPTIONS = [
  { label: "7 days", periods: 168 },   // 7 * 24 hours
  { label: "14 days", periods: 336 },
  { label: "30 days", periods: 720 },
];

export const BPS_PER_PERIOD = 10_000; // divisor for rate calculations
