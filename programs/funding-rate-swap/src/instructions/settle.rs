use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::SwapPosition;
use crate::errors::SwapError;

/// Drift PerpMarket account layout (partial, only fields we need).
/// NOTE: These offsets match Drift Protocol's on-chain layout.
/// In production use Drift SDK; for hackathon we read raw bytes.
const FUNDING_RATE_OFFSET: usize = 278;
const FUNDING_RATE_TS_OFFSET: usize = 286;

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        constraint = position.is_active @ SwapError::PositionInactive,
        constraint = position.settled_periods < position.total_periods @ SwapError::AlreadySettled,
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

    /// Drift PerpMarket account — read-only, used to fetch current funding rate.
    /// CHECK: We read raw bytes from this account; caller must pass the correct address.
    pub drift_perp_market: AccountInfo<'info>,

    #[account(mut)]
    pub keeper: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    // --- 1. Read Drift funding rate from raw account data ---
    let drift_data = ctx.accounts.drift_perp_market.try_borrow_data()?;
    require!(drift_data.len() > FUNDING_RATE_TS_OFFSET + 8, SwapError::FundingRateStale);

    let current_funding_rate = i64::from_le_bytes(
        drift_data[FUNDING_RATE_OFFSET..FUNDING_RATE_OFFSET + 8]
            .try_into()
            .map_err(|_| SwapError::FundingRateStale)?,
    );
    let funding_rate_ts = i64::from_le_bytes(
        drift_data[FUNDING_RATE_TS_OFFSET..FUNDING_RATE_TS_OFFSET + 8]
            .try_into()
            .map_err(|_| SwapError::FundingRateStale)?,
    );
    drop(drift_data);

    // --- 2. Read all needed fields from position (immutable) ---
    let last_settled_at = ctx.accounts.position.last_settled_at;
    let fixed_rate = ctx.accounts.position.fixed_rate;
    let notional = ctx.accounts.position.notional;
    let settled_periods = ctx.accounts.position.settled_periods;
    let total_periods = ctx.accounts.position.total_periods;
    let position_key = ctx.accounts.position.key();
    let position_bump = ctx.accounts.position.bump;

    require!(funding_rate_ts > last_settled_at, SwapError::FundingRateStale);

    let rate_diff = current_funding_rate
        .checked_sub(fixed_rate)
        .ok_or(SwapError::MathOverflow)?;

    // --- 3. Compute and execute settlement transfer ---
    let seeds: &[&[u8]] = &[b"swap_position", position_key.as_ref(), &[position_bump]];
    let position_info = ctx.accounts.position.to_account_info();

    if rate_diff > 0 {
        // Actual > fixed: floating payer → fixed payer
        let amount = compute_settlement_amount(notional, rate_diff, ctx.accounts.floating_vault.amount)?;
        if amount > 0 {
            transfer_between_vaults(
                &ctx.accounts.token_program,
                &ctx.accounts.floating_vault,
                &ctx.accounts.fixed_vault,
                &position_info,
                seeds,
                amount,
            )?;
        }
    } else if rate_diff < 0 {
        // Actual < fixed: fixed payer → floating payer
        let amount = compute_settlement_amount(notional, -rate_diff, ctx.accounts.fixed_vault.amount)?;
        if amount > 0 {
            transfer_between_vaults(
                &ctx.accounts.token_program,
                &ctx.accounts.fixed_vault,
                &ctx.accounts.floating_vault,
                &position_info,
                seeds,
                amount,
            )?;
        }
    }

    // --- 4. Update position state (mutable) ---
    let position = &mut ctx.accounts.position;
    position.settled_periods = settled_periods
        .checked_add(1)
        .ok_or(SwapError::MathOverflow)?;
    position.last_funding_rate = current_funding_rate;
    position.last_settled_at = funding_rate_ts;

    if position.settled_periods >= total_periods {
        position.is_active = false;
        msg!("Position fully settled and closed: {:?}", position_key);
    }

    msg!(
        "Settled period {}/{}: funding_rate={} fixed_rate={} rate_diff={}",
        position.settled_periods,
        total_periods,
        current_funding_rate,
        fixed_rate,
        rate_diff
    );

    Ok(())
}

fn compute_settlement_amount(notional: u64, abs_rate_diff: i64, vault_balance: u64) -> Result<u64> {
    let raw = (notional as i64)
        .checked_mul(abs_rate_diff)
        .ok_or(SwapError::MathOverflow)? / 10_000;
    Ok((raw as u64).min(vault_balance))
}

fn transfer_between_vaults<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.clone(),
            },
            &[seeds],
        ),
        amount,
    )?;
    Ok(())
}
