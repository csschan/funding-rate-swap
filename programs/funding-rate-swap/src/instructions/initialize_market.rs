use anchor_lang::prelude::*;
use crate::state::SwapMarket;

#[derive(Accounts)]
#[instruction(drift_market: Pubkey)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = SwapMarket::LEN,
        seeds = [b"swap_market", drift_market.as_ref()],
        bump
    )]
    pub market: Account<'info, SwapMarket>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeMarket>, drift_market: Pubkey) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.drift_market = drift_market;
    market.authority = ctx.accounts.authority.key();
    market.total_volume = 0;
    market.is_active = true;
    market.order_count = 0;
    market.position_count = 0;
    market.bump = ctx.bumps.market;
    Ok(())
}
