What you're describing is actually a mix of **parimutuel seeding** and **LMSR trading**.

The important question is:

> Are the whale seeds intended to represent **initial beliefs/probabilities** or **liquidity capital**?

Those are different things.

### Problem with showing 2.50 / 3.33 / 3.33 as opening odds

If whales deposit:

```text
Home = 8000
Away = 6000
Draw = 6000
```

and you display:

```text
Home = 2.50
Away = 3.33
Draw = 3.33
```

those are parimutuel odds.

Then suppose a user buys 100 USDC of Home.

In LMSR, the price changes based on the cost function. The odds might move to:

```text
Home = 2.42
Away = 3.40
Draw = 3.40
```

But now the original parimutuel interpretation has broken down because there isn't actually a pool where payouts are determined by pool ratios anymore.

You have transitioned into an AMM.

---

## Recommended architecture

### Phase 1: Pre-open seeding

Whales stake:

```text
Home = 8000
Away = 6000
Draw = 6000
```

Total:

```text
20,000 USDC
```

Compute:

```text
p(Home)=0.40
p(Away)=0.30
p(Draw)=0.30
```

These become your opening probabilities.

### Phase 2: Initialize LMSR

Choose liquidity parameter (B).

For example:

```text
B = 20,000 USDC
```

or

```text
B = total_seed
```

Then initialize:

[
q_i = B\ln(p_i)+C
]

Example:

[
q_H = B\ln(0.4)+C
]

[
q_A = B\ln(0.3)+C
]

[
q_D = B\ln(0.3)+C
]

Now your LMSR starts exactly at:

```text
40%
30%
30%
```

---

### Frontend display

Display both:

| Outcome | Probability | Decimal Odds |
| ------- | ----------- | ------------ |
| Home    | 40%         | 2.50         |
| Away    | 30%         | 3.33         |
| Draw    | 30%         | 3.33         |

using:

[
\text{Odds}=\frac1p
]

---

### User buys Home

User spends 100 USDC.

Your existing:

```rust
lmsr_buy_cost()
```

calculates how many shares are purchased.

Update:

```rust
q_home += delta_q
```

Immediately recompute:

```rust
p_home
p_away
p_draw
```

using `lmsr_price()`.

Maybe now:

```text
Home  = 43%
Away  = 28.5%
Draw  = 28.5%
```

Display:

```text
Home = 2.33
Away = 3.51
Draw = 3.51
```

---

### Settlement

This is where many people get confused.

The payout should **not** be based on the final displayed odds.

The payout should be based on the shares the trader owns.

Suppose Alice bought:

```text
100 outcome shares
```

when Home was 40%.

She paid roughly:

```text
40 USDC
```

for those shares.

If Home wins:

```text
100 shares × $1
= 100 USDC
```

She receives 100 USDC.

If Home loses:

```text
0
```

This is how LMSR prediction markets work.

---

### Why not pay based on the final odds?

Imagine:

```text
Alice buys Home at 40%
```

Then a whale later pushes Home to:

```text
80%
```

If you pay Alice based on the final odds:

```text
1.25x
```

she would actually be penalized for being early and correct.

Prediction markets don't work that way.

Instead:

* Early buyers get cheaper shares.
* Late buyers get expensive shares.
* Every winning share redeems for 1 USDC.

---

### The clean model

1. Whales seed liquidity.
2. Seed ratios determine initial probabilities.
3. Convert those probabilities into LMSR `q`.
4. LMSR handles all subsequent pricing.
5. Users buy and sell outcome shares.
6. Prices update continuously.
7. Winning shares redeem for 1 USDC each.

That gives you:

✅ Continuous pricing
✅ Guaranteed liquidity
✅ Smooth odds movement
✅ Prediction-market probabilities
✅ Good UX from launch
✅ Whale seeders can still receive protocol rewards for providing the initial liquidity

The one thing I'd avoid is using **parimutuel payouts after LMSR trading starts**. Once you have `lmsr_buy_cost()` and `lmsr_sell_payout()`, the natural settlement mechanism is "winning shares pay 1 USDC each," not "final odds determine payouts."
