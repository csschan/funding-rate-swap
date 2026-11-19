use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::SwapPosition;
use crate::errors::SwapError;

/// Only callable after position is fully settled (is_active = false)
/// Returns remaining collateral to each party
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        close = caller,
        constraint = !position.is_active @ SwapError::PositionInactive,
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

    #[account(mut, constraint = fixed_payer_usdc.owner == position.fixed_payer)]
    pub fixed_payer_usdc: Account<'info, TokenAccount>,

    #[account(mut, constraint = floating_payer_usdc.owner == position.floating_payer)]
    pub floating_payer_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub caller: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClosePosition>) -> Result<()> {
    let position_key = ctx.accounts.position.key();
    let position_bump = ctx.accounts.position.bump;
    let seeds = &[b"swap_position".as_ref(), position_key.as_ref(), &[position_bump]];
    let signer_seeds = &[&seeds[..]];

    // Return remaining collateral to fixed payer
    let fixed_balance = ctx.accounts.fixed_vault.amount;
    if fixed_balance > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fixed_vault.to_account_info(),
                    to: ctx.accounts.fixed_payer_usdc.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer_seeds,
            ),
            fixed_balance,
        )?;
    }

    // Return remaining collateral to floating payer
    let floating_balance = ctx.accounts.floating_vault.amount;
    if floating_balance > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.floating_vault.to_account_info(),
                    to: ctx.accounts.floating_payer_usdc.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer_seeds,
            ),
            floating_balance,
        )?;
    }

    // Close vaults
    for vault in [
        ctx.accounts.fixed_vault.to_account_info(),
        ctx.accounts.floating_vault.to_account_info(),
    ] {
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: vault,
                destination: ctx.accounts.caller.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    msg!("Position closed: {:?}", position_key);
    Ok(())
}
