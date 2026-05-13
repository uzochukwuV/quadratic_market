use anchor_lang::prelude::*;

#[error_code]
pub enum QuadraticMarketError {
    // 0-99: General errors
    #[msg("Not authorized")]
    Unauthorized = 0,
    #[msg("Protocol is paused")]
    Paused = 1,
    #[msg("Invalid amount")]
    InvalidAmount = 2,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity = 3,
    #[msg("Math overflow")]
    MathOverflow = 4,
    #[msg("Math underflow")]
    MathUnderflow = 5,

    // 100-199: Market errors
    #[msg("Market not open for trading")]
    MarketNotOpen = 100,
    #[msg("Market has already started")]
    MarketAlreadyStarted = 101,
    #[msg("Invalid outcome ID")]
    InvalidOutcomeId = 102,
    #[msg("Maximum exposure reached")]
    MaxExposureReached = 103,
    #[msg("Market already settled")]
    MarketAlreadySettled = 104,
    #[msg("Invalid number of outcomes")]
    InvalidNumOutcomes = 105,
    #[msg("Market not settled")]
    MarketNotSettled = 106,
    #[msg("Market bond already claimed")]
    BondAlreadyClaimed = 107,
    #[msg("Market not voidable")]
    MarketNotVoidable = 108,
    #[msg("Invalid market status for this operation")]
    InvalidMarketStatus = 109,
    #[msg("Market has expired for new positions")]
    MarketExpired = 110,

    // 200-299: Trading errors
    #[msg("Insufficient shares to sell")]
    InsufficientShares = 200,
    #[msg("Slippage exceeded: minimum shares not received")]
    SlippageExceeded = 201,
    #[msg("LMSR cost exceeds maximum payment")]
    LmsrCostExceedsMax = 202,
    #[msg("LMSR sell price below minimum")]
    LmsrSellBelowMin = 203,

    // 300-399: Settlement errors
    #[msg("Challenge window still active")]
    ChallengeWindowActive = 300,
    #[msg("Challenge window has expired")]
    ChallengeWindowExpired = 301,
    #[msg("Dispute stake too low")]
    DisputeStakeTooLow = 302,
    #[msg("Maximum dispute rounds reached")]
    MaxDisputeRounds = 303,
    #[msg("No dispute to finalize")]
    NoDisputeToFinalize = 304,
    #[msg("Invalid proposed outcome")]
    InvalidProposedOutcome = 305,
    #[msg("Result already proposed")]
    ResultAlreadyProposed = 306,

    // 400-499: LP errors
    #[msg("Amount too small for first deposit")]
    AmountTooSmall = 400,
    #[msg("Insufficient LP shares")]
    InsufficientLpShares = 401,
    #[msg("Withdrawal request already exists")]
    WithdrawalAlreadyExists = 402,
    #[msg("No withdrawal request found")]
    NoWithdrawalRequest = 403,
    #[msg("Insufficient free liquidity for withdrawal")]
    InsufficientFreeLiquidity = 404,

    // 500-599: Claim errors
    #[msg("No winning positions to claim")]
    NoWinningPositions = 500,
    #[msg("Payout already claimed")]
    PayoutAlreadyClaimed = 501,
    #[msg("Wrong outcome token for claim")]
    WrongOutcomeToken = 502,

    // 600-699: Swap errors
    #[msg("Swap amount below minimum")]
    SwapBelowMinimum = 600,
    #[msg("Swap failed")]
    SwapFailed = 601,
}
