# FundingSwap — Funding Rate Swap Protocol on Solana

## The Problem

Billions of dollars in perpetual positions on Solana are exposed to **funding rate risk** with zero protection. Funding rates on Jupiter Perps and Pacifica can swing wildly every hour — a leveraged long paying 0.1 bps/h today could be paying 5 bps/h tomorrow. There is no on-chain primitive to hedge, trade, or arbitrage this risk.

## The Solution

FundingSwap introduces **funding rate swaps** — a new tradeable asset class on Solana. Lock in a fixed funding rate and swap it against the live floating rate. If the floating rate moves against you, the swap pays you the difference.

| Role | You pay | You receive | You profit when |
|------|---------|-------------|-----------------|
| **Fixed Payer** | Fixed rate you choose | Live floating rate | Floating rate rises above your fixed rate |
| **Floating Payer** | Live floating rate | Fixed rate | Floating rate drops below the fixed rate |

### Use Case 1: Hedge

You hold a leveraged SOL long on Jupiter — you're paying an hourly borrow fee that could spike anytime. Open a **Fixed Payer** swap on FundingSwap to cap that cost. If the borrow fee spikes, the swap pays you the difference.

Connect wallet → FundingSwap reads your Jupiter / Pacifica positions → one-click **"Hedge Funding"** pre-fills a swap matching your position.

### Use Case 2: Speculate

No perp position needed. Think funding rates are going up? Go Fixed Payer. Think they're going down? Go Floating Payer. Trade funding rates as a standalone asset with up to 10x leverage.

### Use Case 3: Cross-Platform Arbitrage

Jupiter uses a **borrow fee** model (based on JLP pool utilization). Pacifica uses a traditional **funding rate** (order-book premium). These are fundamentally different pricing mechanisms — when they diverge on the same asset, the spread is capturable profit.

The homepage shows a live **Cross-Platform Arbitrage** panel comparing rates from both platforms with estimated daily yield.

### ProAMM — Instant Fill, Close Anytime

The protocol itself acts as the permanent counterparty via a **Protocol AMM**:

- Open a position instantly — no orderbook, no waiting for a match
- Close at **any time** before expiry with real-time P&L
- P&L = `notional × (currentRate − fixedRate) × elapsedPeriods / 10,000`
- Supports leverage (1x–10x) on the notional

> Built for the Solana Hackathon — Perps & Prediction Markets track.

**Program ID:** `EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC` (Devnet)
**Protocol AMM:** `JDMRgqodDHFGCAStE92KrcV8qPBs3whsHopiMC4UMs67` (Devnet)

---

## Supported Platforms

| Platform | Rate Model | Data Source | Assets |
|----------|-----------|-------------|--------|
| **Jupiter Perps** | Hourly borrow fee (jump rate model based on JLP utilization) | On-chain custody accounts | SOL, ETH, BTC |
| **Pacifica** | Hourly funding rate (order-book premium) | REST API (`/info/prices`) | SOL, ETH, BTC + 70 markets |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Solana Program                     │
│                                                      │
│  initialize_market    — create a swap market         │
│  place_order          — post to orderbook            │
│  match_orders         — match fixed/floating orders  │
│  settle               — settle after each period     │
│                                                      │
│  initialize_amm       — create protocol AMM          │
│  open_position_amm    — instant fill against AMM     │
│  early_close_amm      — close anytime, get P&L       │
└─────────────────────────────────────────────────────┘
         ↑
┌────────────────────────────────────────────────────┐
│                   Next.js App                       │
│                                                     │
│  / — markets + arbitrage panel + perp positions     │
│  /market/[sym]  — trade (hedge mode / arb mode)     │
│  /portfolio     — active swap positions + P&L       │
│                                                     │
│  /api/markets         — Jupiter + Pacifica rates    │
│  /api/perp-positions  — read user perp positions    │
│  /api/positions       — read swap positions         │
└────────────────────────────────────────────────────┘
         ↑
┌────────────────────────────────────────────────────┐
│              External Data Sources                  │
│                                                     │
│  Jupiter Perps (mainnet) — custody accounts,        │
│    jump rate model (minRate/maxRate/targetRate),     │
│    user position PDAs via getProgramAccounts         │
│                                                     │
│  Pacifica (REST API) — /info/prices for live        │
│    funding rates, /positions for user positions     │
└────────────────────────────────────────────────────┘
```

**Key accounts:**
- `SwapMarket` — per-asset market (SOL-PERP, ETH-PERP, BTC-PERP)
- `SwapPosition` — a live swap position between two parties
- `ProtocolAmm` — global AMM singleton, acts as counterparty
- Per-position token vaults (fixed + floating) hold collateral in USDC

---

## Getting Started

### Prerequisites

- Rust + Solana CLI `2.3.x`
- Anchor `0.31.1`
- Node.js `18+`, Yarn

### Build

```bash
# Install dependencies
yarn install
cd frontend && npm install && cd ..

# Build program (uses platform-tools v1.53 for edition2024 compat)
cargo-build-sbf --tools-version v1.53

# Or via anchor
anchor build
```

### Deploy to Devnet

```bash
solana config set --url devnet
anchor deploy

# Initialize the Protocol AMM and fund its treasury
npx ts-node --skip-project scripts/init-amm.ts 10000
```

### Run Frontend

```bash
cd frontend
npm run dev -- -p 6001
# → http://localhost:6001
```

---

## Program Instructions

### Orderbook Flow (peer-to-peer)

| Instruction | Description |
|-------------|-------------|
| `initialize_market` | Create a swap market for a perp asset |
| `place_order` | Post a fixed or floating rate order |
| `cancel_order` | Cancel an unmatched order |
| `match_orders` | Match a fixed-payer with a floating-payer |
| `settle` | Settle one funding period |
| `add_collateral` | Top up position collateral |
| `close_position` | Close after expiry |
| `liquidate` | Liquidate undercollateralized position |

### AMM Flow (instant)

| Instruction | Description |
|-------------|-------------|
| `initialize_amm` | Create the protocol AMM + USDC treasury |
| `open_position_amm` | Instant position against protocol AMM |
| `early_close_amm` | Close at any time, settle P&L at current rate |

---

## Rate Encoding

Rates are stored as `i64` in units of **basis points × 100**:
- On-chain value `4500` = display `45.00 bps/h`
- P&L formula: `notional × rateDiff × periods / 10_000`

---

## Data Sources

### Jupiter Perps (on-chain)

Jupiter uses a **borrow fee** model. The rate is calculated via a **jump rate model** from each custody account:

```
Custody account offsets:
  offset 352: minRateBps        (u64, annual bps)
  offset 360: maxRateBps        (u64, annual bps)
  offset 368: targetRateBps     (u64, annual bps)
  offset 376: targetUtilization (u64, scaled by 1e9)

Rate calculation:
  if utilization <= targetUtil:
    yearlyBps = minRate + (targetRate - minRate) × util / targetUtil
  else:
    yearlyBps = targetRate + (maxRate - targetRate) × (util - targetUtil) / (1 - targetUtil)

  hourlyBps = yearlyBps / 8760
```

User positions: `getProgramAccounts` with owner filter at offset 8, position account size 218 bytes.

### Pacifica (REST API)

```
GET https://api.pacifica.fi/api/v1/info/prices
→ { data: [{ symbol: "SOL", funding: "0.0000125", ... }] }

funding × 10000 = bps/h

GET https://api.pacifica.fi/api/v1/positions?account=<WALLET>
→ [{ symbol, side, amount, entry_price, margin, ... }]
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Anchor 0.31.1 / Solana |
| Token Standard | SPL Token (USDC) |
| Frontend | Next.js 15, Tailwind v4, Zustand |
| Wallet | Solana Wallet Adapter (Phantom, Solflare) |
| Funding Rate Data | Jupiter Perps (on-chain), Pacifica (REST API) |

---

## Project Structure

```
funding-rate-swap/
├── programs/
│   └── funding-rate-swap/
│       └── src/
│           ├── instructions/
│           │   ├── initialize_market.rs
│           │   ├── place_order.rs / cancel_order.rs
│           │   ├── match_orders.rs / settle.rs
│           │   ├── initialize_amm.rs
│           │   ├── open_position_amm.rs
│           │   └── early_close_amm.rs
│           ├── state/
│           │   ├── market.rs / order.rs / position.rs
│           │   └── amm.rs
│           └── errors/
├── frontend/
│   └── src/
│       ├── app/            # Next.js pages + API routes
│       │   └── api/
│       │       ├── markets/         # Jupiter + Pacifica rate aggregation
│       │       ├── perp-positions/  # Read user perp positions
│       │       └── positions/       # Read swap positions
│       ├── components/
│       │   ├── ArbitragePanel.tsx   # Cross-platform rate comparison
│       │   ├── PerpPositions.tsx    # User perp positions + hedge buttons
│       │   ├── OpenPositionForm.tsx # Swap position form (hedge/arb prefill)
│       │   ├── PositionCard.tsx     # Active position with live P&L
│       │   └── RateSimulator.tsx    # Live rate simulation for demo
│       ├── lib/
│       │   ├── funding.ts          # Jupiter + Pacifica data fetchers
│       │   ├── program.ts          # On-chain transaction builders
│       │   ├── pda.ts              # PDA derivation helpers
│       │   └── constants.ts        # Market configs, custody addresses
│       └── store/                  # Zustand state
├── scripts/
│   └── init-amm.ts                 # Initialize AMM + fund treasury
└── tests/
```

---

## License

MIT
