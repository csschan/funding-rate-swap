use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{ProtocolAmm, SwapPosition, Direction};
use crate::errors::SwapError;

#[derive(Accounts)]
#[instruction(
    direction: Direction,
    notional: u64,
    fixed_rate: i64,
    duration_periods: u32,
    collateral_amount: u64
)]
pub struct OpenPositionAmm<'info> {
    #[account(
        mut,
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
        init,
        payer = user,
        space = SwapPosition::LEN,
        seeds = [b"amm_pos", amm.key().as_ref(), &amm.position_count.to_le_bytes()],
        bump,
    )]
    pub position: Box<Account<'info, SwapPosition>>,

    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = position,
        seeds = [b"vault", position.key().as_ref(), b"fixed"],
        bump,
    )]
    pub fixed_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = position,
        seeds = [b"vault", position.key().as_ref(), b"floating"],
        bump,
    )]
    pub floating_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = user_usdc.owner == user.key() @ SwapError::Unauthorized,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    /// CHECK: only used as token mint reference
    pub usdc_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<OpenPositionAmm>,
    direction: Direction,
    notional: u64,
    fixed_rate: i64,
    duration_periods: u32,
    collateral_amount: u64,
) -> Result<()> {
    // Verify treasury has enough to cover the AMM's side
    require!(
        ctx.accounts.amm_treasury.amount >= collateral_amount,
        SwapError::InsufficientTreasuryFunds
    );

    let amm_key = ctx.accounts.amm.key();
    let amm_bump = ctx.accounts.amm.bump;
    let position_id = ctx.accounts.amm.position_count;

    // AMM signer seeds for treasury transfers
    let amm_seeds: &[&[u8]] = &[b"protocol_amm", &[amm_bump]];
    let amm_signer = &[amm_seeds];

    match direction {
        Direction::FixedPayer => {
            // User is FixedPayer: user deposits → fixed_vault, AMM deposits → floating_vault
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_usdc.to_account_info(),
                        to: ctx.accounts.fixed_vault.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                collateral_amount,
            )?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.amm_treasury.to_account_info(),
                        to: ctx.accounts.floating_vault.to_account_info(),
                        authority: ctx.accounts.amm.to_account_info(),
                    },
                    amm_signer,
                ),
                collateral_amount,
            )?;
        }
        Direction::FloatingPayer => {
            // User is FloatingPayer: user deposits → floating_vault, AMM deposits → fixed_vault
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_usdc.to_account_info(),
                        to: ctx.accounts.floating_vault.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                collateral_amount,
            )?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.amm_treasury.to_account_info(),
                        to: ctx.accounts.fixed_vault.to_account_info(),
                        authority: ctx.accounts.amm.to_account_info(),
                    },
                    amm_signer,
                ),
                collateral_amount,
            )?;
        }
    }

    let now = Clock::get()?.unix_timestamp;
    let user_key = ctx.accounts.user.key();
    let fixed_vault_key = ctx.accounts.fixed_vault.key();
    let floating_vault_key = ctx.accounts.floating_vault.key();
    let position_bump = ctx.bumps.position;

    let (position_fixed_payer, position_floating_payer) = match direction {
        Direction::FixedPayer => (user_key, amm_key),
        Direction::FloatingPayer => (amm_key, user_key),
    };

    let position = &mut ctx.accounts.position;

    position.market = Pubkey::default();
    position.fixed_payer = position_fixed_payer;
    position.floating_payer = position_floating_payer;
    position.notional = notional;
    position.fixed_rate = fixed_rate;
    position.start_time = now;
    position.total_periods = duration_periods;
    position.settled_periods = 0;
    position.last_funding_rate = 0;
    position.last_settled_at = now;
    position.fixed_vault = fixed_vault_key;
    position.floating_vault = floating_vault_key;
    position.position_id = position_id;
    position.is_active = true;
    position.bump = position_bump;

    let amm = &mut ctx.accounts.amm;
    amm.position_count = amm
        .position_count
        .checked_add(1)
        .ok_or(SwapError::MathOverflow)?;

    msg!(
        "AMM position opened: id={} direction={:?} notional={} fixed_rate={} periods={}",
        position_id,
        direction,
        notional,
        fixed_rate,
        duration_periods,
    );
    Ok(())
}
