use anchor_lang::prelude::*;

#[account]
pub struct ProtocolAmm {
    pub authority: Pubkey,
    pub position_count: u64,
    pub bump: u8,
    pub treasury_bump: u8,
}

impl ProtocolAmm {
    pub const LEN: usize = 8 + 32 + 8 + 1 + 1;
}
