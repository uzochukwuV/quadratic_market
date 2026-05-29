"""
Odds conversion utilities for the Quadratic Market sports bot.

Converts decimal odds from The-Odds-API to LMSR q_values.
The LMSR pricing engine uses q_values to determine implied probabilities.

Formula: q_i = B * ln(total_implied / individual_implied)
Where:
  B = liquidity parameter (default 100_000_000 = 100 USDC)
  total_implied = sum of all 1/odds_i
  individual_implied = 1/odds_i
  
Simplified for seeding: q_i = int(1_000_000_000 / odds_i)
This gives q_values proportional to implied probability,
scaled so B=100M represents the base liquidity pool.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

SCALE = 1 << 32  # Q32.32 fixed point scale
DEFAULT_B = 100_000_000  # 100 USDC liquidity parameter


def decimal_odds_to_q_values(
    odds: list[float],
    b: int = DEFAULT_B,
) -> list[int]:
    """
    Convert decimal odds to LMSR q_values.
    
    Args:
        odds: List of decimal odds (e.g., [2.50, 3.20, 2.80] for Home/Draw/Away)
        b: Liquidity parameter B (default 100_000_000 = 100 USDC)
        
    Returns:
        List of q_values (integers) for the LMSR pricing engine.
        
    Example:
        >>> odds = [2.50, 3.20, 2.80]
        >>> q = decimal_odds_to_q_values(odds)
        >>> # q might be [400000000, 312500000, 357142857] (scaled)
    """
    if not odds:
        return []
    
    # Calculate total implied probability
    total_implied = sum(1.0 / o for o in odds)
    
    # q_i = B * (total_implied / individual_implied) / num_outcomes
    # This gives prices approximately matching the odds
    # A simpler and more robust formula:
    # q_i = int(B * 1_000_000 / odds_i) where the scale factor ensures
    # prices approximately match the decimal odds when B=100M
    
    q_values = []
    for o in odds:
        if o <= 0:
            q_values.append(0)
        else:
            # Use a simple inverse scaling
            # q_i should be large when odds are small (high probability)
            q_val = int(b / o)
            # Scale up to give reasonable price range
            q_val = int(q_val * 4_294_967.296)  # Scale factor to work with Q32.32
            q_values.append(max(q_val, 1))  # Ensure non-zero
    
    return q_values


def q_values_from_api_odds(
    home_odds: float,
    draw_odds: Optional[float] = None,
    away_odds: Optional[float] = None,
) -> list[int]:
    """
    Convert API odds (home, draw, away) to q_values.
    
    Args:
        home_odds: Decimal odds for home win
        draw_odds: Decimal odds for draw (None for 2-way markets)
        away_odds: Decimal odds for away win
        
    Returns:
        List of q_values for [home, draw?, away] outcomes
    """
    odds = [home_odds]
    if draw_odds is not None:
        odds.append(draw_odds)
    if away_odds is not None:
        odds.append(away_odds)
    
    return decimal_odds_to_q_values(odds)


@dataclass
class MarketType:
    """Defines a type of market that can be created per fixture."""
    category: int
    name: str
    key: str  # The-Odds-API market key
    outcomes: list[str]  # Outcome names in order [outcome_0, outcome_1, ...]
    has_draw: bool  # Whether this market type has a draw outcome


# Football market types supported
FOOTBALL_MARKET_TYPES = [
    MarketType(
        category=0,
        name="Match Result",
        key="h2h",
        outcomes=["Home Win", "Draw", "Away Win"],
        has_draw=True,
    ),
    MarketType(
        category=1,
        name="Both Teams To Score",
        key="btts",
        outcomes=["Yes", "No"],
        has_draw=False,
    ),
    MarketType(
        category=2,
        name="Over/Under 2.5 Goals",
        key="totals",
        outcomes=["Over 2.5", "Under 2.5"],
        has_draw=False,
    ),
]


def get_market_type(category: int) -> Optional[MarketType]:
    """Get market type by category number."""
    for mt in FOOTBALL_MARKET_TYPES:
        if mt.category == category:
            return mt
    return None


def get_market_outcome_name(category: int, outcome_id: int) -> str:
    """Get the name of an outcome by category and outcome_id."""
    mt = get_market_type(category)
    if mt and outcome_id < len(mt.outcomes):
        return mt.outcomes[outcome_id]
    return f"Outcome {outcome_id}"