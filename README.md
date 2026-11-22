# FundingSwap — Funding Rate Swap Protocol on Solana

Perpetual traders on Solana pay funding rates that can swing from +100 bps to −50 bps per 8 hours with no warning. There is currently no on-chain primitive to hedge this risk or trade it as an asset.

FundingSwap introduces **funding rate swaps** as a new tradeable instrument on Solana. A user locks in a fixed rate and exchanges it against the floating Drift funding rate over a chosen duration — turning an unpredictable cost center into a manageable, tradeable position.

**What this enables:**
- **Perp traders** lock in a fixed funding cost and eliminate rate volatility risk
- **Rate speculators** go long or short on where funding rates are heading
- **Arbitrageurs** exploit the spread between the implied fixed rate and the live Drift rate for near risk-free yield

The protocol uses a **ProAMM** design: the protocol itself acts as the permanent counterparty, so positions fill instantly and can be closed at any time — no orderbook wait, no counterparty needed. This brings TradFi interest rate swap mechanics on-chain, fully permissionless, with Solana-native settlement in USDC.

> Built for the Solana Hackathon — Perps & Prediction Markets track.

**Program ID:** `EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC` (Devnet)
**Protocol AMM:** `JDMRgqodDHFGCAStE92KrcV8qPBs3whsHopiMC4UMs67` (Devnet)

---

## What It Does

Funding rates on perpetual exchanges fluctuate constantly. Traders holding large perp positions face unpredictable funding costs. FundingSwap lets them lock in a fixed rate.

| Role | You pay | You receive | Win when |
|------|---------|-------------|----------|
| **Fixed Payer** | Fixed rate (e.g. 45 bps/8h) | Floating rate (actual Drift rate) | Funding goes up |
| **Floating Payer** | Floating rate | Fixed rate | Funding goes down |

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
│  settle               — settle after each 8h period  │
│                                                      │
│  initialize_amm       — create protocol AMM          │
│  open_position_amm    — instant fill against AMM     │
│  early_close_amm      — close anytime, get P&L       │
└─────────────────────────────────────────────────────┘
         ↑
┌─────────────────┐
│   Next.js App   │
│                 │
│  / — markets    │
│  /market/[sym]  │
│  /portfolio     │
└─────────────────┘
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
| `initialize_market` | Create a swap market for a Drift perp |
| `place_order` | Post a fixed or floating rate order |
| `cancel_order` | Cancel an unmatched order |
| `match_orders` | Match a fixed-payer with a floating-payer |
| `settle` | Settle one 8h funding period |
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
- Display: `45.00 bps/8h`
- On-chain: `4500`
- P&L formula: `notional × rateDiff × periods / 10_000`

---

## Arbitrage Use Case

If Drift's live funding rate (floating) diverges from your locked-in fixed rate, you can exit the position profitably:

```
Live rate:   63 bps/8h
Fixed rate:  45 bps/8h
Spread:      +18 bps → you're winning as Fixed Payer
→ Close Now → collect P&L immediately
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Anchor 0.31.1 / Solana |
| Token Standard | SPL Token (USDC) |
| Frontend | Next.js 15, Tailwind v4, Zustand |
| Wallet | Solana Wallet Adapter (Phantom, Solflare) |
| Funding Rate Data | Drift Protocol (mainnet read) |

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
│       ├── app/          # Next.js pages + API routes
│       ├── components/   # UI components
│       ├── lib/          # program.ts, pda.ts, fetchPortfolio.ts
│       └── store/        # Zustand state
├── scripts/
│   └── init-amm.ts       # Initialize AMM + fund treasury
└── tests/
```

---

## License

MIT
