use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{SwapMarket, SwapOrder, Direction, SwapPosition};
use crate::errors::SwapError;

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(
        mut,
        seeds = [b"swap_market", market.drift_market.as_ref()],
        bump = market.bump,
        constraint = market.is_active @ SwapError::MarketInactive,
    )]
    pub market: Account<'info, SwapMarket>,

    #[account(
        init,
        payer = owner,
        space = SwapOrder::LEN,
        seeds = [b"swap_order", market.key().as_ref(), &market.order_count.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, SwapOrder>,

    /// Temporary collateral vault for this order
    #[account(
        init,
        payer = owner,
        token::mint = usdc_mint,
        token::authority = order,
        seeds = [b"order_vault", order.key().as_ref()],
        bump
    )]
    pub order_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, constraint = owner_usdc.owner == owner.key())]
    pub owner_usdc: Account<'info, TokenAccount>,

    pub usdc_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<PlaceOrder>,
    direction: Direction,
    notional: u64,
    fixed_rate: i64,
    duration_periods: u32,
    collateral_amount: u64,
) -> Result<()> {
    let min_collateral = notional
        .checked_mul(SwapPosition::MIN_COLLATERAL_BPS)
        .ok_or(SwapError::MathOverflow)?
        / 10_000;

    require!(collateral_amount >= min_collateral, SwapError::InsufficientCollateral);

    // Transfer collateral from owner to order vault
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.owner_usdc.to_account_info(),
            to: ctx.accounts.order_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, collateral_amount)?;

    let market = &mut ctx.accounts.market;
    let order = &mut ctx.accounts.order;

    order.market = market.key();
    order.owner = ctx.accounts.owner.key();
    order.direction = direction;
    order.notional = notional;
    order.fixed_rate = fixed_rate;
    order.duration_periods = duration_periods;
    order.created_at = Clock::get()?.unix_timestamp;
    order.order_id = market.order_count;
    order.bump = ctx.bumps.order;

    market.order_count = market.order_count.checked_add(1).ok_or(SwapError::MathOverflow)?;

    msg!("Order placed: {:?} notional={} fixed_rate={}", market.key(), notional, fixed_rate);
    Ok(())
}
