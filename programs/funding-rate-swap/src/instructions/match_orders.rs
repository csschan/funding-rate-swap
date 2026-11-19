use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{SwapMarket, SwapOrder, SwapPosition, Direction};
use crate::errors::SwapError;

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(
        mut,
        seeds = [b"swap_market", market.drift_market.as_ref()],
        bump = market.bump,
        constraint = market.is_active @ SwapError::MarketInactive,
    )]
    pub market: Account<'info, SwapMarket>,

    /// Must be FixedPayer direction
    #[account(
        mut,
        close = fixed_payer,
        constraint = fixed_order.direction == Direction::FixedPayer @ SwapError::DirectionMismatch,
        constraint = fixed_order.market == market.key(),
    )]
    pub fixed_order: Box<Account<'info, SwapOrder>>,

    /// Must be FloatingPayer direction
    #[account(
        mut,
        close = floating_payer,
        constraint = floating_order.direction == Direction::FloatingPayer @ SwapError::DirectionMismatch,
        constraint = floating_order.market == market.key(),
        // FixedPayer's max rate >= FloatingPayer's min rate (price match)
        constraint = fixed_order.fixed_rate >= floating_order.fixed_rate @ SwapError::DirectionMismatch,
        constraint = fixed_order.notional == floating_order.notional @ SwapError::NotionalMismatch,
        constraint = fixed_order.duration_periods == floating_order.duration_periods @ SwapError::DurationMismatch,
    )]
    pub floating_order: Box<Account<'info, SwapOrder>>,

    #[account(
        init,
        payer = matcher,
        space = SwapPosition::LEN,
        seeds = [b"swap_position", market.key().as_ref(), &market.position_count.to_le_bytes()],
        bump
    )]
    pub position: Box<Account<'info, SwapPosition>>,

    /// Fixed payer collateral vault (from order) → becomes position vault
    #[account(
        mut,
        seeds = [b"order_vault", fixed_order.key().as_ref()],
        bump
    )]
    pub fixed_order_vault: Account<'info, TokenAccount>,

    /// Floating payer collateral vault (from order) → becomes position vault
    #[account(
        mut,
        seeds = [b"order_vault", floating_order.key().as_ref()],
        bump
    )]
    pub floating_order_vault: Account<'info, TokenAccount>,

    /// New position vault for fixed payer
    #[account(
        init,
        payer = matcher,
        token::mint = usdc_mint,
        token::authority = position,
        seeds = [b"vault", position.key().as_ref(), b"fixed"],
        bump
    )]
    pub fixed_vault: Account<'info, TokenAccount>,

    /// New position vault for floating payer
    #[account(
        init,
        payer = matcher,
        token::mint = usdc_mint,
        token::authority = position,
        seeds = [b"vault", position.key().as_ref(), b"floating"],
        bump
    )]
    pub floating_vault: Account<'info, TokenAccount>,

    /// CHECK: verified by order account
    #[account(mut)]
    pub fixed_payer: AccountInfo<'info>,

    /// CHECK: verified by order account
    #[account(mut)]
    pub floating_payer: AccountInfo<'info>,

    #[account(mut)]
    pub matcher: Signer<'info>,

    pub usdc_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<MatchOrders>) -> Result<()> {
    let fixed_order = &ctx.accounts.fixed_order;
    let floating_order = &ctx.accounts.floating_order;

    // Agreed rate is the midpoint of the two orders
    let agreed_rate = (fixed_order.fixed_rate + floating_order.fixed_rate) / 2;

    // Move fixed payer collateral to position vault
    let fixed_order_key = fixed_order.key();
    let fixed_bump = ctx.bumps.fixed_order_vault;
    let fixed_seeds = &[b"order_vault", fixed_order_key.as_ref(), &[fixed_bump]];
    let fixed_signer = &[&fixed_seeds[..]];

    let fixed_amount = ctx.accounts.fixed_order_vault.amount;
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.fixed_order_vault.to_account_info(),
                to: ctx.accounts.fixed_vault.to_account_info(),
                authority: ctx.accounts.fixed_order_vault.to_account_info(),
            },
            fixed_signer,
        ),
        fixed_amount,
    )?;

    // Move floating payer collateral to position vault
    let floating_order_key = floating_order.key();
    let floating_bump = ctx.bumps.floating_order_vault;
    let floating_seeds = &[b"order_vault", floating_order_key.as_ref(), &[floating_bump]];
    let floating_signer = &[&floating_seeds[..]];

    let floating_amount = ctx.accounts.floating_order_vault.amount;
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.floating_order_vault.to_account_info(),
                to: ctx.accounts.floating_vault.to_account_info(),
                authority: ctx.accounts.floating_order_vault.to_account_info(),
            },
            floating_signer,
        ),
        floating_amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;
    let position = &mut ctx.accounts.position;

    position.market = market.key();
    position.fixed_payer = ctx.accounts.fixed_payer.key();
    position.floating_payer = ctx.accounts.floating_payer.key();
    position.notional = fixed_order.notional;
    position.fixed_rate = agreed_rate;
    position.start_time = now;
    position.total_periods = fixed_order.duration_periods;
    position.settled_periods = 0;
    position.last_funding_rate = 0;
    position.last_settled_at = now;
    position.fixed_vault = ctx.accounts.fixed_vault.key();
    position.floating_vault = ctx.accounts.floating_vault.key();
    position.position_id = market.position_count;
    position.is_active = true;
    position.bump = ctx.bumps.position;

    market.total_volume = market.total_volume.saturating_add(fixed_order.notional);
    market.position_count = market.position_count.checked_add(1).ok_or(SwapError::MathOverflow)?;

    msg!("Position opened: notional={} fixed_rate={} periods={}", position.notional, agreed_rate, position.total_periods);
    Ok(())
}
