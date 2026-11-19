use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct SwapMarket {
    /// Drift PerpMarket account address (source of funding rate)
    pub drift_market: Pubkey,
    /// Protocol authority (admin)
    pub authority: Pubkey,
    /// Cumulative notional volume (USDC, 6 decimals)
    pub total_volume: u64,
    /// Whether the market accepts new orders
    pub is_active: bool,
    /// Order count used for order PDA seeds
    pub order_count: u64,
    /// Position count used for position PDA seeds
    pub position_count: u64,
    pub bump: u8,
}

impl SwapMarket {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 1;
}
