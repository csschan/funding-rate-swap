# FundingSwap — Funding Rate Swap Protocol on Solana

Perpetual traders on Solana pay funding rates that change every hour on Jupiter, every hour on Pacifica — unpredictable, and there is currently no on-chain primitive to hedge this risk or trade it as an asset.

FundingSwap introduces **funding rate swaps** as a new tradeable instrument on Solana. A user locks in a fixed rate and exchanges it against the live floating funding rate over a chosen duration — turning an unpredictable cost center into a manageable, tradeable position.

**What this enables:**
- **Perp traders** connect their Jupiter / Pacifica positions and one-click hedge their funding rate exposure
- **Rate speculators** go long or short on where funding rates are heading
- **Cross-platform arbitrageurs** capture the rate spread between Jupiter and Pacifica for near risk-free yield

**Supported Platforms:**
- **Jupiter Perps** — on-chain custody account reading, borrow rate calculated via jump rate model (SOL, ETH, BTC)
- **Pacifica** — REST API integration, real-time 1h funding rate (SOL, ETH, BTC and 70+ markets)

The protocol uses a **ProAMM** design: the protocol itself acts as the permanent counterparty, so positions fill instantly and can be closed at any time — no orderbook wait, no counterparty needed. This brings TradFi interest rate swap mechanics on-chain, fully permissionless, with Solana-native settlement in USDC.

> Built for the Solana Hackathon — Perps & Prediction Markets track.

**Program ID:** `EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC` (Devnet)
**Protocol AMM:** `JDMRgqodDHFGCAStE92KrcV8qPBs3whsHopiMC4UMs67` (Devnet)

---

## What It Does

Funding rates on perpetual exchanges fluctuate constantly. Traders holding large perp positions face unpredictable funding costs. FundingSwap lets them lock in a fixed rate.

| Role | You pay | You receive | Win when |
|------|---------|-------------|----------|
| **Fixed Payer** | Fixed rate (e.g. 0.35 bps/h) | Floating rate (live rate) | Funding goes up |
| **Floating Payer** | Floating rate | Fixed rate | Funding goes down |

### Three Use Cases

#### 1. Hedge — Protect your perp position

Connect your wallet → FundingSwap reads your Jupiter / Pacifica perp positions → one-click **"Hedge Funding"** opens a swap that locks in your funding cost.

- Long on Jupiter SOL-PERP? → Open a Fixed Payer swap to cap your borrow fee
- Short on Pacifica BTC-PERP? → Open a Floating Payer swap to lock in your funding income

#### 2. Speculate — Trade funding rates as an asset

Think SOL funding rates will spike? Go Fixed Payer to profit from the rise. Think they'll drop? Go Floating Payer.

#### 3. Cross-Platform Arbitrage — Capture rate spreads

Jupiter charges a **borrow fee** (based on JLP pool utilization via jump rate model), while Pacifica uses a traditional **funding rate** (order-book premium). These rates diverge because they use fundamentally different pricing mechanisms.

```
Jupiter SOL borrow:    0.33 bps/h  (jump rate model, ~65% utilization)
Pacifica SOL funding:  0.13 bps/h  (order-book premium)
Spread:                0.20 bps/h  → capturable via funding rate swap
```

The **Cross-Platform Arbitrage** panel on the homepage shows live rate comparisons and estimated daily yield per $10k notional.

### ProAMM — Close Anytime

Unlike orderbook-based swaps that require a matched counterparty, FundingSwap uses a **Protocol AMM** as the permanent counterparty:

- Open a position instantly — no waiting for a match
- Close at **any time** before expiry with real-time P&L
- P&L = `notional × (currentRate − fixedRate) × elapsedPeriods / 10,000`
- Supports leverage (1x–10x) on the notional position

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
│  / — markets + perp positions + arbitrage panel     │
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
- Display: `0.35 bps/h`
- On-chain: `35`
- P&L formula: `notional × rateDiff × periods / 10_000`

---

## Data Sources

### Jupiter Perps (on-chain)

Jupiter uses a **borrow fee** model instead of traditional funding rates. The borrow rate is calculated via a **jump rate model** from each custody account:

```
Custody account offsets (confirmed):
  offset 352: minRateBps     (u64, annual bps)
  offset 360: maxRateBps     (u64, annual bps)
  offset 368: targetRateBps  (u64, annual bps)
  offset 376: targetUtilization (u64, scaled by 1e9)

Rate calculation:
  if utilization <= targetUtil:
    yearlyBps = minRate + (targetRate - minRate) × util / targetUtil
  else:
    yearlyBps = targetRate + (maxRate - targetRate) × (util - targetUtil) / (1 - targetUtil)

  hourlyBps = yearlyBps / 8760
```

User positions are read via `getProgramAccounts` with owner filter at offset 8.

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
│       │   └── RateSimulator.tsx    # Mock live rate for demo
│       ├── lib/
│       │   ├── drift.ts            # Jupiter + Pacifica data fetchers
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
