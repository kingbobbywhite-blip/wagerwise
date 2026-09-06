# Methodology

Every number the app shows traces back through the same five steps. This document explains
each one and names the assumptions, because an expected-value figure whose assumptions you
cannot see is worse than no figure at all.

## 1. Strip the vig

A sportsbook's posted price is not a probability. It is a probability plus a margin. A
standard `-110 / -110` prop implies 52.4% on each side, summing to 104.8%. That extra 4.8%
is the hold.

Comparing a DFS line to a raw implied probability manufactures edge that does not exist.
Four devigging methods are available:

| Method | Behaviour |
| --- | --- |
| **Power** (default) | Solves for `k` where the sum of `p^k` equals 1. Handles the favourite-longshot bias reasonably and is the best general choice for player props. |
| **Shin** | Models the margin as protection against informed bettors. Shades longshots harder. |
| **Proportional** | Divides each price by the overround. Simple, but overstates longshot probability. |
| **Additive** | Subtracts the margin evenly. Only defensible on near-even two-way markets. |

If only one side is priced the hold cannot be measured, so a typical margin is assumed and
the resulting projection is marked lower confidence.

## 2. Turn the fair probability into a projection

Given that the fair probability of clearing 25.5 points is 53%, what average must the player
be expected to score? The app inverts the line probability through the market's own outcome
distribution to recover an implied mean.

This matters because the DFS app is usually offering a *different* number than the
sportsbook. Recovering the mean lets the same market opinion be re-evaluated at 24.5, or
26.5, or wherever the app has it.

Evidence is then blended, weighted by default as:

- Devigged market price: 0.62
- Your own projection: 0.26
- Recent form, with a minutes adjustment: 0.12

The market weight is high on purpose. A devigged two-way price is the aggregate forecast of
everyone with money at risk, and it beats almost every public model. Lowering it below your
own model's weight is a strong claim about your model.

## 3. Model the outcome distribution

Box-score stats are integers, and small-mean counting stats are strongly skewed. Treating
them as normal misprices exactly the tails where parlay legs live, and prices whole-number
pushes at zero.

The app picks a discrete family from the mean and variance:

- **Negative binomial** when overdispersed, which covers points, rebounds, assists.
- **Poisson** at parity, which covers steals.
- **Binomial** when underdispersed.
- **Normal** for genuinely continuous stats such as minutes.

Dispersion is a per-market ratio of variance to mean:

| Market | Ratio | At a 25 mean this implies |
| --- | --- | --- |
| Points | 2.60 | standard deviation ≈ 8.1 |
| Pts+Reb+Ast | 2.20 | ≈ 7.4 |
| Rebounds, Assists | 1.25 | ≈ 5.6 |
| 3-Pointers Made | 1.15 | ≈ 5.4 |
| Steals | 1.05 | ≈ 5.1 |

These are priors fitted to typical NBA game-log behaviour, not measured constants. They are
the single largest modelling assumption in the app, and the outcome-spread slider in
settings scales all of them at once.

Uncertainty about the projection is folded into the outcome spread. A shaky projection
produces probabilities closer to 50%, which is the honest response to not knowing.

### Line resolution

- Half-point line (24.5): over is `P(X ≥ 25)`, under is `P(X ≤ 24)`, no push.
- Whole-number line (24): over is `P(X ≥ 25)`, under is `P(X ≤ 23)`, push is `P(X = 24)`.

Pushes are not losses. On a DFS entry a pushed leg voids and the entry shrinks to the next
smaller payout table, which the simulator reproduces.

## 4. Model correlation between legs

Multiplying leg probabilities assumes independence. NBA legs are not independent:

- A player's points and threes move together (≈ +0.46).
- A player's points and his PRA are nearly the same bet (≈ +0.7).
- Team-mates compete for shots, but share pace and overtime. The net is near zero.
- A guard's assists and his team-mate's points are linked by the made basket.
- Opposing players share the game's pace.
- Betting opposite sides of correlated stats flips the sign.

Legs are simulated under a Gaussian copula: draw correlated normals, compare each against
thresholds derived from that leg's win and push probability. The correlation matrix is
assembled from structural priors, then shrunk toward the identity until it is a valid
covariance matrix. Shrinking toward the identity means shrinking toward independence, which
is the conservative direction.

Every entry reports what its expected value would have been under the independence
assumption, so the size of the correction is always visible.

## 5. Price the entry and size the stake

The simulation produces a full distribution over payout multiples, not just a win
probability. Expected value is the probability-weighted return, less the stake.

Stake sizing uses Kelly generalised to multi-outcome payoffs: it maximises expected log
growth numerically rather than using the two-outcome closed form, because a flex entry has
three or more possible returns.

Two guards sit on top:

- **Fractional Kelly**, defaulting to a quarter. Full Kelly is growth-optimal only if your
  probabilities are exactly right. They are estimates, and overestimating edge makes Kelly
  overbet in a way that compounds badly.
- **A hard percentage cap** per entry, defaulting to 2% of bankroll, which overrides Kelly.

## The optimizer

Rather than a fixed rule such as "one leg per stat market", the app runs a beam search over
candidate legs, scoring each partial entry with the correlation-aware simulator against the
real payout table for the selected app and mode. Constraints on legs per game, legs per
team, legs per player and average correlation are applied during the search.

Objectives available:

- **Max expected value** — highest average return per dollar.
- **Max bankroll growth** — maximises expected log growth at the Kelly stake, which is what
  actually compounds. Prefers lower variance.
- **Highest floor** — maximises probability of profit among entries that are not negative EV.
- **Upside** — chases the largest payout without going negative EV.

Results are deduplicated and diversity-filtered so you get genuinely different entries
rather than five variations on the same four legs. The simulation is seeded from the entry's
own contents, so the same slate always produces the same recommendations.

## Calibration

The tracker compares the probability the model gave each leg against whether it actually
cashed, bucketed by predicted band, and reports Brier score, log loss and overall bias.

A model that says 70% and delivers 55% will drain a bankroll while looking like variance.
Calibration is the only diagnostic that catches it. It needs volume: a gap is only
highlighted once it exceeds two standard errors on at least twenty legs, and the headline
bias figure stays neutral until roughly a hundred legs have settled.
