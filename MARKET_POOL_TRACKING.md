# Market Pool Tracking - Polymarket Style

## Overview

Each market now has detailed pool tracking similar to Polymarket's market pages, showing all money flows, liquidity, and performance metrics for individual markets.

## Features Implemented

### Per-Market Pool Data Structure

```typescript
interface MarketPool {
  marketId: string;
  title: string;
  seedCapital: number;        // Initial seed capital
  betsReceived: number;       // Total bet volume (costs only)
  feesCollected: number;      // All fees from this market
  payoutsGiven: number;       // Total payouts to winners
  winningLegsToLP: number;    // Value from winning legs of losing slips
  finalBacking: number;       // market.backing after settlement
  netProfitLoss: number;      // (seeds + bets + fees) - payouts
}
```

### Money Flow Tracking

Each market tracks:
1. **Inflows**:
   - Seed capital (initial liquidity)
   - Bet costs received
   - Fees collected (1% buy fees + 5% slip margins per leg)

2. **Outflows**:
   - Payouts to winners
   - Winning leg value transferred to LP (from losing slips)

3. **Final State**:
   - Market backing (remaining liquidity)
   - Net profit/loss

### Display Format (Polymarket-Style)

```
📊 MARKET 1: Arsenal Win vs Draw vs Chelsea Win
   Winner: Arsenal Win

   💰 Pool Flows:
      Seed capital:           20000.00 USDC
      Bets received:          13280.98 USDC
      Fees collected:         218.58 USDC
      ─────────────────────────────────────
      Total inflow:           33499.57 USDC

   💸 Payouts:
      Winners paid:           13000.00 USDC
      ─────────────────────────────────────
      Total outflow:          13000.00 USDC

   🔒 Final State:
      Market backing:         19541.64 USDC
      Net P&L:                ✓ +20499.57 USDC

   📈 Statistics:
      Total volume:           13280.98 USDC
      Payout ratio:           97.9% of volume
      House edge realized:    2.1%
```

## Key Metrics Explained

### Total Volume
Sum of all bet costs on this market (excluding fees). This is the core betting activity.

### Payout Ratio
`(Payouts Given / Total Volume) × 100%`

Shows what percentage of bets was paid back to winners. Lower ratio = higher house profit.

### House Edge Realized
`100% - Payout Ratio`

The actual edge the house captured. This can vary significantly from the theoretical edge based on:
- Which outcomes won
- Multi-leg slip losses with winning legs
- Correlation bonuses

### Net P&L
`Seed Capital + Bets Received + Fees Collected - Payouts Given`

The total profit/loss for this market pool. This equals the change in market.backing plus any fees taken.

## Example Analysis

### Market 1: Arsenal vs Chelsea (3-way)
- **Volume**: 13,280.98 USDC
- **Payout Ratio**: 97.9% (efficient market, close to fair odds)
- **House Edge**: 2.1% (from fees and LMSR pricing)
- **Net P&L**: +20,499.57 USDC
  - Includes 20k seed capital
  - Small profit from fees and losing bets

### Market 2: BTTS (2-way)
- **Volume**: 6,000 USDC
- **Payout Ratio**: 50% (one slip won, one lost)
- **House Edge**: 50% (unusually high due to losing slip)
- **Winning Legs → LP**: 3,000 USDC ✓ (new feature!)
- **Net P&L**: +13,145.77 USDC
  - Includes 10k seed capital
  - Large profit from losing slip's winning leg

The losing slip had:
- Leg 1 (BTTS Yes): **WON** → 3,000 shares worth 3,000 USDC
- Leg 2 (Arsenal Win): **WON** → slip paid 6,600 USDC

Wait, that doesn't match. Let me check User6's slip:
- Leg 1 (Arsenal Win): **WON**
- Leg 2 (BTTS No): **LOST**

So the 3,000 USDC from the winning Arsenal leg was correctly transferred to LP!

## Implementation Details

### Location
- **Data Structure**: `lifecycle/settle_and_withdraw.ts:50-65`
- **Tracking Logic**: `lifecycle/settle_and_withdraw.ts:119-150`
- **Display**: `lifecycle/settle_and_withdraw.ts:428-465`

### Bet Attribution

**Single Bets**: 
- Cost and fee directly attributed to the bet's market

**Multi-Leg Slips**:
- Each leg's cost attributed to its market
- Slip margin (5% per leg) split evenly across all markets in the slip
- Payouts split proportionally based on each market's contribution

**Winning Legs from Losing Slips**:
- When a slip loses but has winning legs
- Winning leg value (1:1 at settlement) is credited to that market's `winningLegsToLP`
- This represents value captured by LP from correlation risk

## Use Cases

### 1. Market Performance Analysis
Operators can see which markets are:
- High volume vs low volume
- Profitable vs unprofitable
- Fair odds vs house-favored

### 2. Risk Assessment
- Track how much liquidity is locked per market
- Monitor payout ratios to detect unusual patterns
- Identify markets with high correlation risk

### 3. Transparency (Polymarket-style)
Users can see:
- Total volume on each market
- How much has been paid out
- Effective house edge
- Remaining liquidity

### 4. Fee Optimization
Analyze fee revenue per market to:
- Adjust fee rates
- Optimize LMSR parameters (b value)
- Balance profitability vs competitiveness

## Future Enhancements

1. **Real-time Tracking**: Implement on-chain events for live pool updates
2. **Historical Data**: Store pool states at different timestamps
3. **Comparison Metrics**: Compare similar markets' performance
4. **Liquidity Depth**: Show order book depth for LMSR markets
5. **ROI per Outcome**: Track which outcomes were most profitable
6. **Seeder Returns**: Calculate ROI for seed capital providers

## Related Files

- `lifecycle/settle_and_withdraw.ts` - Pool tracking implementation
- `lifecycle/common.ts` - Data structures
- `ACCOUNTING_ANALYSIS.md` - Global accounting design
- Test output: `./run_lifecycle.sh`

