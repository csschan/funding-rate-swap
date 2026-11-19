use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    /// Pays fixed rate, receives floating (funding rate) — hedger
    FixedPayer,
    /// Pays floating rate (funding rate), receives fixed — yield seeker
    FloatingPayer,
}

impl Default for Direction {
    fn default() -> Self {
        Direction::FixedPayer
    }
}

#[account]
#[derive(Default)]
pub struct SwapOrder {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub direction: Direction,
    /// USDC notional amount (6 decimals)
    pub notional: u64,
    /// Fixed rate in basis points per 8h (e.g. 50 = 0.05%)
    pub fixed_rate: i64,
    /// Contract duration in 8h periods
    pub duration_periods: u32,
    pub created_at: i64,
    /// Order ID for PDA seed
    pub order_id: u64,
    pub bump: u8,
}

impl SwapOrder {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 4 + 8 + 8 + 1;
}
