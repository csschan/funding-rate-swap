use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::state::ProtocolAmm;

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(
        init,
        payer = admin,
        space = ProtocolAmm::LEN,
        seeds = [b"protocol_amm"],
        bump,
    )]
    pub amm: Account<'info, ProtocolAmm>,

    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = amm,
        seeds = [b"amm_treasury"],
        bump,
    )]
    pub amm_treasury: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeAmm>) -> Result<()> {
    let amm = &mut ctx.accounts.amm;
    amm.authority = ctx.accounts.admin.key();
    amm.position_count = 0;
    amm.bump = ctx.bumps.amm;
    amm.treasury_bump = ctx.bumps.amm_treasury;
    Ok(())
}
