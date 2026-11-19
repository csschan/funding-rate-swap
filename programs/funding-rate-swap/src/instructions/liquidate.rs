use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::SwapPosition;
use crate::errors::SwapError;

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(
        mut,
        close = liquidator,
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

    #[account(mut, constraint = fixed_payer_usdc.owner == position.fixed_payer)]
    pub fixed_payer_usdc: Account<'info, TokenAccount>,

    #[account(mut, constraint = floating_payer_usdc.owner == position.floating_payer)]
    pub floating_payer_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(mut, constraint = liquidator_usdc.owner == liquidator.key())]
    pub liquidator_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let position = &ctx.accounts.position;
    let notional = position.notional;

    let fixed_balance = ctx.accounts.fixed_vault.amount;
    let floating_balance = ctx.accounts.floating_vault.amount;

    // Check if either side is below liquidation threshold
    let fixed_health = fixed_balance.checked_mul(10_000).ok_or(SwapError::MathOverflow)? / notional;
    let floating_health = floating_balance.checked_mul(10_000).ok_or(SwapError::MathOverflow)? / notional;

    require!(
        fixed_health < SwapPosition::LIQUIDATION_THRESHOLD_BPS
            || floating_health < SwapPosition::LIQUIDATION_THRESHOLD_BPS,
        SwapError::PositionHealthy
    );

    let position_key = position.key();
    let position_bump = position.bump;
    let seeds = &[b"swap_position".as_ref(), position_key.as_ref(), &[position_bump]];
    let signer_seeds = &[&seeds[..]];

    // Liquidator bonus: 1% of total collateral
    let total_collateral = fixed_balance.saturating_add(floating_balance);
    let liquidator_bonus = total_collateral / 100;

    // Transfer liquidator bonus
    if liquidator_bonus > 0 {
        // Take bonus from the unhealthy side's vault first
        let (bonus_vault, remaining) = if fixed_health < SwapPosition::LIQUIDATION_THRESHOLD_BPS {
            (ctx.accounts.fixed_vault.to_account_info(), fixed_balance.saturating_sub(liquidator_bonus))
        } else {
            (ctx.accounts.floating_vault.to_account_info(), floating_balance.saturating_sub(liquidator_bonus))
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: bonus_vault,
                    to: ctx.accounts.liquidator_usdc.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer_seeds,
            ),
            liquidator_bonus.min(total_collateral),
        )?;
        let _ = remaining; // remaining collateral returned below
    }

    // Return remaining collateral to each party
    let fixed_remaining = ctx.accounts.fixed_vault.amount;
    if fixed_remaining > 0 {
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
            fixed_remaining,
        )?;
    }

    let floating_remaining = ctx.accounts.floating_vault.amount;
    if floating_remaining > 0 {
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
            floating_remaining,
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
                destination: ctx.accounts.liquidator.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    msg!("Position liquidated: {:?} fixed_health={}bps floating_health={}bps", position_key, fixed_health, floating_health);
    Ok(())
}
