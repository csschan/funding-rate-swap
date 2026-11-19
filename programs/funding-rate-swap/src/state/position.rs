use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct SwapPosition {
    pub market: Pubkey,
    pub fixed_payer: Pubkey,
    pub floating_payer: Pubkey,
    /// USDC notional (6 decimals)
    pub notional: u64,
    /// Agreed fixed rate in basis points per 8h
    pub fixed_rate: i64,
    pub start_time: i64,
    pub total_periods: u32,
    pub settled_periods: u32,
    /// Last settled funding rate (for verification)
    pub last_funding_rate: i64,
    /// Last settlement timestamp
    pub last_settled_at: i64,
    /// Fixed payer collateral vault
    pub fixed_vault: Pubkey,
    /// Floating payer collateral vault
    pub floating_vault: Pubkey,
    pub position_id: u64,
    pub is_active: bool,
    pub bump: u8,
}

impl SwapPosition {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 32 + 8 + 1 + 1;

    /// Collateral health: collateral_balance / notional (basis points)
    /// Liquidation threshold: < 300 bps (3%)
    pub const LIQUIDATION_THRESHOLD_BPS: u64 = 300;

    /// Minimum collateral ratio to open: 10%
    pub const MIN_COLLATERAL_BPS: u64 = 1000;
}
