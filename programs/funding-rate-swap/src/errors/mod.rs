use anchor_lang::prelude::*;

#[error_code]
pub enum SwapError {
    #[msg("Market is not active")]
    MarketInactive,
    #[msg("Insufficient collateral")]
    InsufficientCollateral,
    #[msg("Order direction mismatch")]
    DirectionMismatch,
    #[msg("Notional amount mismatch")]
    NotionalMismatch,
    #[msg("Duration mismatch")]
    DurationMismatch,
    #[msg("Position is not active")]
    PositionInactive,
    #[msg("Position already fully settled")]
    AlreadySettled,
    #[msg("Funding rate not updated yet")]
    FundingRateStale,
    #[msg("Position is healthy, cannot liquidate")]
    PositionHealthy,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Protocol AMM treasury has insufficient funds")]
    InsufficientTreasuryFunds,
    #[msg("This position was not created via AMM")]
    NotAmmPosition,
}
