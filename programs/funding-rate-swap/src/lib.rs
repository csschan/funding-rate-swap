use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::Direction;
use instructions::add_collateral::Side;
use instructions::{InitializeAmm, OpenPositionAmm, EarlyCloseAmm};

declare_id!("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");

#[program]
pub mod funding_rate_swap {
    use super::*;

    /// Create a new swap market for a Drift perp asset
    pub fn initialize_market(ctx: Context<InitializeMarket>, drift_market: Pubkey) -> Result<()> {
        instructions::initialize_market::handler(ctx, drift_market)
    }

    /// Place an order (FixedPayer or FloatingPayer)
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        direction: Direction,
        notional: u64,
        fixed_rate: i64,
        duration_periods: u32,
        collateral_amount: u64,
    ) -> Result<()> {
        instructions::place_order::handler(ctx, direction, notional, fixed_rate, duration_periods, collateral_amount)
    }

    /// Cancel an open order and reclaim collateral
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        instructions::cancel_order::handler(ctx)
    }

    /// Match a FixedPayer order with a FloatingPayer order to open a position
    pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()> {
        instructions::match_orders::handler(ctx)
    }

    /// Settle one 8-hour period (called by Keeper)
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }

    /// Add more collateral to an active position
    pub fn add_collateral(ctx: Context<AddCollateral>, amount: u64, side: Side) -> Result<()> {
        instructions::add_collateral::handler(ctx, amount, side)
    }

    /// Close a fully settled position and return remaining collateral
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handler(ctx)
    }

    /// Liquidate an undercollateralized position
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handler(ctx)
    }

    /// Initialize the Protocol AMM and its USDC treasury vault
    pub fn initialize_amm(ctx: Context<InitializeAmm>) -> Result<()> {
        instructions::initialize_amm::handler(ctx)
    }

    /// Open a position directly against the AMM (no order book)
    pub fn open_position_amm(
        ctx: Context<OpenPositionAmm>,
        direction: Direction,
        notional: u64,
        fixed_rate: i64,
        duration_periods: u32,
        collateral_amount: u64,
    ) -> Result<()> {
        instructions::open_position_amm::handler(
            ctx,
            direction,
            notional,
            fixed_rate,
            duration_periods,
            collateral_amount,
        )
    }

    /// Early close an AMM position at any time — settles elapsed periods and returns collateral
    pub fn early_close_amm(
        ctx: Context<EarlyCloseAmm>,
        position_id: u64,
        current_rate: i64,
    ) -> Result<()> {
        instructions::early_close_amm::handler(ctx, position_id, current_rate)
    }
}
