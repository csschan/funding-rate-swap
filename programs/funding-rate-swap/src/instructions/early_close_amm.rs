use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::{ProtocolAmm, SwapPosition};
use crate::errors::SwapError;

const PERIOD_SECONDS: i64 = 8 * 3600; // 28_800

#[derive(Accounts)]
#[instruction(position_id: u64, current_rate: i64)]
pub struct EarlyCloseAmm<'info> {
    #[account(
        seeds = [b"protocol_amm"],
        bump = amm.bump,
    )]
    pub amm: Account<'info, ProtocolAmm>,

    #[account(
        mut,
        seeds = [b"amm_treasury"],
        bump = amm.treasury_bump,
    )]
    pub amm_treasury: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = caller,
        constraint = position.is_active @ SwapError::PositionInactive,
        seeds = [b"amm_pos", amm.key().as_ref(), &position_id.to_le_bytes()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, SwapPosition>>,

    #[account(
        mut,
        seeds = [b"vault", position.key().as_ref(), b"fixed"],
        bump,
    )]
    pub fixed_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", position.key().as_ref(), b"floating"],
        bump,
    )]
    pub floating_vault: Account<'info, TokenAccount>,

    /// The caller's USDC token account — receives their side's remaining collateral
    #[account(
        mut,
        constraint = user_usdc.owner == caller.key() @ SwapError::Unauthorized,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    /// Must be fixed_payer or floating_payer on the position
    #[account(mut)]
    pub caller: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<EarlyCloseAmm>,
    position_id: u64,
    current_rate: i64,
) -> Result<()> {
    // --- 1. Authorization ---
    require!(
        ctx.accounts.caller.key() == ctx.accounts.position.fixed_payer
            || ctx.accounts.caller.key() == ctx.accounts.position.floating_payer,
        SwapError::Unauthorized
    );

    // --- 2. Snapshot all position fields we need before any mutable borrows ---
    let now = Clock::get()?.unix_timestamp;
    let last_settled_at = ctx.accounts.position.last_settled_at;
    let fixed_rate = ctx.accounts.position.fixed_rate;
    let notional = ctx.accounts.position.notional;
    let total_periods = ctx.accounts.position.total_periods;
    let settled_periods = ctx.accounts.position.settled_periods;
    let position_bump = ctx.accounts.position.bump;
    let fixed_payer = ctx.accounts.position.fixed_payer;
    let floating_payer = ctx.accounts.position.floating_payer;
    let amm_key = ctx.accounts.amm.key();

    // --- 3. Compute elapsed periods since last settlement ---
    let elapsed_seconds = now.saturating_sub(last_settled_at).max(0);
    let remaining_periods = total_periods.saturating_sub(settled_periods);
    let elapsed_periods = {
        let raw = elapsed_seconds / PERIOD_SECONDS;
        (raw as u32).min(remaining_periods)
    };

    // --- 4. Signer seeds for position PDA (signs vault transfers) ---
    // Build owned bytes first so borrows are valid for the full scope
    let position_id_bytes = position_id.to_le_bytes();
    let pos_seeds: &[&[u8]] = &[
        b"amm_pos",
        amm_key.as_ref(),
        position_id_bytes.as_ref(),
        &[position_bump],
    ];
    let pos_signer = &[pos_seeds];

    // --- 5. Settlement transfer for elapsed periods ---
    if elapsed_periods > 0 {
        let rate_diff = current_rate
            .checked_sub(fixed_rate)
            .ok_or(SwapError::MathOverflow)?;

        if rate_diff > 0 {
            // Floating vault → Fixed vault (fixed payer wins)
            let raw = (notional as i128)
                .checked_mul(rate_diff as i128)
                .ok_or(SwapError::MathOverflow)?
                .checked_mul(elapsed_periods as i128)
                .ok_or(SwapError::MathOverflow)?
                / 10_000i128;
            let amount = (raw as u64).min(ctx.accounts.floating_vault.amount);
            if amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.floating_vault.to_account_info(),
                            to: ctx.accounts.fixed_vault.to_account_info(),
                            authority: ctx.accounts.position.to_account_info(),
                        },
                        pos_signer,
                    ),
                    amount,
                )?;
            }
        } else if rate_diff < 0 {
            // Fixed vault → Floating vault (floating payer wins)
            let abs_diff = rate_diff
                .checked_neg()
                .ok_or(SwapError::MathOverflow)?;
            let raw = (notional as i128)
                .checked_mul(abs_diff as i128)
                .ok_or(SwapError::MathOverflow)?
                .checked_mul(elapsed_periods as i128)
                .ok_or(SwapError::MathOverflow)?
                / 10_000i128;
            let amount = (raw as u64).min(ctx.accounts.fixed_vault.amount);
            if amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.fixed_vault.to_account_info(),
                            to: ctx.accounts.floating_vault.to_account_info(),
                            authority: ctx.accounts.position.to_account_info(),
                        },
                        pos_signer,
                    ),
                    amount,
                )?;
            }
        }
    }

    // --- 6. Capture caller key for routing decisions ---
    let caller_key = ctx.accounts.caller.key();

    // --- 7. Return fixed_vault balance ---
    let fixed_balance = ctx.accounts.fixed_vault.amount;
    if fixed_balance > 0 {
        if fixed_payer == caller_key {
            // Return to user
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.fixed_vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    pos_signer,
                ),
                fixed_balance,
            )?;
        } else {
            // Return to AMM treasury
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.fixed_vault.to_account_info(),
                        to: ctx.accounts.amm_treasury.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    pos_signer,
                ),
                fixed_balance,
            )?;
        }
    }

    // --- 8. Return floating_vault balance ---
    let floating_balance = ctx.accounts.floating_vault.amount;
    if floating_balance > 0 {
        if floating_payer == caller_key {
            // Return to user
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.floating_vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    pos_signer,
                ),
                floating_balance,
            )?;
        } else {
            // Return to AMM treasury
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.floating_vault.to_account_info(),
                        to: ctx.accounts.amm_treasury.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    pos_signer,
                ),
                floating_balance,
            )?;
        }
    }

    // --- 9. Close vault token accounts (rent → caller) ---
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.fixed_vault.to_account_info(),
            destination: ctx.accounts.caller.to_account_info(),
            authority: ctx.accounts.position.to_account_info(),
        },
        pos_signer,
    ))?;

    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.floating_vault.to_account_info(),
            destination: ctx.accounts.caller.to_account_info(),
            authority: ctx.accounts.position.to_account_info(),
        },
        pos_signer,
    ))?;

    // --- 10. Mark inactive (position account itself is closed via `close = caller`) ---
    ctx.accounts.position.is_active = false;

    msg!(
        "AMM position early-closed: id={} elapsed_periods={} current_rate={} fixed_rate={}",
        position_id,
        elapsed_periods,
        current_rate,
        fixed_rate,
    );
    Ok(())
}
