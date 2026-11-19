use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::SwapPosition;
use crate::errors::SwapError;

#[derive(Accounts)]
pub struct AddCollateral<'info> {
    #[account(
        constraint = position.is_active @ SwapError::PositionInactive,
    )]
    pub position: Account<'info, SwapPosition>,

    #[account(
        mut,
        seeds = [b"vault", position.key().as_ref(), b"fixed"],
        bump
    )]
    pub fixed_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", position.key().as_ref(), b"floating"],
        bump
    )]
    pub floating_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, constraint = user_usdc.owner == user.key())]
    pub user_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum Side {
    Fixed,
    Floating,
}

pub fn handler(ctx: Context<AddCollateral>, amount: u64, side: Side) -> Result<()> {
    let destination = match side {
        Side::Fixed => {
            require!(
                ctx.accounts.position.fixed_payer == ctx.accounts.user.key(),
                SwapError::Unauthorized
            );
            ctx.accounts.fixed_vault.to_account_info()
        }
        Side::Floating => {
            require!(
                ctx.accounts.position.floating_payer == ctx.accounts.user.key(),
                SwapError::Unauthorized
            );
            ctx.accounts.floating_vault.to_account_info()
        }
    };

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc.to_account_info(),
                to: destination,
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    msg!("Collateral added: amount={}", amount);
    Ok(())
}
