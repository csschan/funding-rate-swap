use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::SwapOrder;
use crate::errors::SwapError;

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        close = owner,
        constraint = order.owner == owner.key() @ SwapError::Unauthorized,
    )]
    pub order: Account<'info, SwapOrder>,

    #[account(
        mut,
        seeds = [b"order_vault", order.key().as_ref()],
        bump
    )]
    pub order_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = owner_usdc.owner == owner.key())]
    pub owner_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelOrder>) -> Result<()> {
    // The vault authority is the order PDA, not the vault PDA.
    // Reconstruct order PDA seeds: [b"swap_order", market, order_id_le8]
    let market_key = ctx.accounts.order.market;
    let order_id_bytes = ctx.accounts.order.order_id.to_le_bytes();
    let bump = ctx.accounts.order.bump;
    let seeds: &[&[u8]] = &[b"swap_order", market_key.as_ref(), &order_id_bytes, &[bump]];
    let signer_seeds = &[seeds];

    // Return collateral to owner
    let collateral = ctx.accounts.order_vault.amount;
    if collateral > 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.order_vault.to_account_info(),
                to: ctx.accounts.owner_usdc.to_account_info(),
                authority: ctx.accounts.order.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, collateral)?;
    }

    // Close vault account, reclaim rent to owner
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.order_vault.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.order.to_account_info(),
        },
        signer_seeds,
    );
    token::close_account(close_ctx)?;

    Ok(())
}
