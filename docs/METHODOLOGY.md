# Methodology

Every number the app shows traces back through the same steps. This document explains each
one and names the assumptions, because an expected-value figure whose assumptions you cannot
see is worse than no figure at all.

## 0. The pricing gate

A prop is **priced** only if a real sportsbook price stands behind it. Everything else is
**unpriced**: shown on the board for context, excluded from expected value, and rejected by
the optimizer.

This is the most important rule in the app and it is not configurable. Without it, a
projection assembled from season averages gets compared against a line the market has
already priced, and the difference between the two gets reported as edge. It is not edge. It
is the gap between a weak estimate and a strong one, pointing the wrong way.

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

Power is the default. Proportional devigging spreads the margin evenly in probability terms,
which overstates longshot probability, and on a prop board the longshots are exactly the
sides sitting furthest from the number. Selecting it in settings raises a warning.

### Not every book counts equally

A handful of books make the market: they take large limits from sharp bettors, move on that
action, and their number is the closest thing to fair that exists. Most retail books copy
those numbers with a wider margin and shade them toward public money.

| Book | Tier | Weight |
| --- | --- | --- |
| Pinnacle | market-making | 1.00 |
| Circa | market-making | 0.85 |
| BetOnline, BookMaker | sharp | 0.50 |
| LowVig | sharp | 0.45 |
| DraftKings, FanDuel | retail | 0.20 |
| BetMGM, Caesars | retail | 0.15 |
| ESPN BET | retail | 0.10 |
| Anything unrecognised | unknown | 0.10 |

The combined retail weight is capped at 0.45 no matter how many retail books are present.
That cap matters: retail books copy the same source, so five of them is one opinion counted
five times, not five independent opinions. Without the cap a crowd of copycats outvotes the
book that set the number.

Each book's price is converted to an implied mean at its own line, and the consensus is the
weighted average of those means. Going through the mean rather than the probability is what
lets books posting different numbers be combined at all. A row with no market-making book
behind it is flagged, and settings can be set to treat it as unpriced outright.

Quotes carry a timestamp. Past the stale threshold they are flagged; past the discard
threshold they are thrown out and the prop reverts to unpriced. Lines move on injury news, so
a price from before the inactives were posted is worse than no price.

## 2. Turn the fair probability into a projection

Given that the fair probability of clearing 25.5 points is 53%, what average must the player
be expected to score? The app inverts the line probability through the market's own outcome
distribution to recover an implied mean.

This matters because the DFS app is usually offering a *different* number than the
sportsbook. Recovering the mean lets the same market opinion be re-evaluated at 24.5, or
26.5, or wherever the app has it.

### When there genuinely is no price

Unpriced props still get an estimate where one is possible, so the board is not full of blank
rows, but the estimate never promotes them to priced.

The order of preference:

1. **Game log.** Per-game values give both a centre and a *measured* spread. A season average
   gives a centre and nothing else, so a player averaging 20 on steady 14-shot nights and one
   averaging 20 on wild 8-to-34 swings look identical, when they are completely different
   bets at the same line. Where minutes are present the projection is rebuilt as
   per-minute rate times projected minutes, which is what makes a rotation change tractable.
   Recent games are weighted more heavily; the observed spread is floored at the market prior
   so a short flat log cannot claim certainty, and widened further below ten games.
2. **A supplied projection**, priced with the market's prior spread.
3. **Season and recent averages**, the weakest input the app accepts, flagged as such.
4. **Nothing.** The row is kept so you can see what you captured, but shows dashes rather
   than a manufactured coin flip.

Minutes are adjusted before anything else, because minutes drive every counting stat:
a back-to-back trims 1.5, three or more days rest adds 0.5, and each rotation player ruled
out adds two, capped at six. The adjustments are deliberately small. A wrong minutes call
ruins the projection, and a large speculative adjustment is worse than none.

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

### The payout comes off your screen

Stored payout tables are seeds for a form, not a source of truth. Operators change
multipliers by state, by promotion and by sport, and boosted picks override them outright. So
the build screen shows a capture panel pre-filled from the stored table, you correct it to
whatever the app is displaying, and you confirm it. Nothing is priced until you do, and the
captured table is stored with the slip so settlement later uses the same numbers.

### Break-even, printed beside every expected value

The per-leg hit rate at which an entry returns exactly the stake is the sum across every
paying tier:

```
E[M] = sum over k of  C(n,k) p^k (1-p)^(n-k) * M(n,k)
```

solved for the p where `E[M] = 1`. For an all-or-nothing table this reduces to the familiar
`M^(-1/n)`, but for anything with partial-payout tiers that shortcut ignores every dollar the
lower tiers return and is badly wrong. A PrizePicks 3-pick flex breaks even at 59.1%; the
shortcut claims 76.3%.

That number sits next to every expected value in the app, with the legs' average probability
under it. It is a sanity check you cannot avoid looking at: if the break-even is not a
plausible per-leg hit rate, the captured multiplier is wrong and the expected value beside it
is fiction. An entry whose break-even lands outside 35% to 85%, or whose expected value
exceeds twenty percent, says so on the card.

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


## The daily pipeline

The one-button flow runs the same engine over data it fetches for itself.

### Finding a mispriced offer

A handful of books set the number and the rest copy it, with a lag. When a retail book is
still offering Over 24.5 at -105 while the sharp consensus says that side is worth -130,
the difference is yours.

Two rules keep this from being circular:

1. **Leave-one-out.** The book being evaluated is excluded from the consensus it is
   measured against. Otherwise a book partly prices itself and every quote looks slightly
   like value.
2. **A real reference.** At least one market-making book must remain after that exclusion.
   A consensus of copies is not a reference price, it is the same lag measured twice.

For each surviving offer the consensus mean is inverted into a distribution, the fair
probability at *that book's line* is read off it, and the edge is `fairProb × decimal − 1`.
Anything above a configurable floor is reported, with a full-Kelly fraction attached.

An edge above 12% is flagged and sorted below smaller believable ones. On a liquid market
a double-digit edge is a line that already moved, a prop matched to the wrong player, or a
book about to void the bet, far more often than it is free money.

### Building the parlay

Parlays are constructed only from legs that are individually positive expected value.
There is no combination of bad bets that becomes a good one; stacking small losses
multiplies the loss.

They are also built **one book at a time**. A leg at DraftKings cannot be combined with a
leg at FanDuel onto a single ticket, so taking the best price for each leg across books
produces a parlay nobody can place. Within a book every leg is priced at that book's own
number, and the best parlay across all books wins.

Payout is the exact product of the surviving legs' decimal prices, not an approximation, so
a pushed leg drops out of the parlay rather than losing it. The break-even figure shown
beside a parlay's expected value is the per-leg rate an equivalent all-or-nothing entry
would need, which makes it directly comparable to the pick'em bar.

The leg probability floor is lower for parlays than for pick'em entries, on purpose. On a
DFS app every leg is roughly even money, so a leg under 50% is close to worthless. On a
sportsbook the price carries the value: a +160 leg that hits 45% of the time is an
excellent bet.

### Pick'em targets

Nothing in this codebase can see a DFS app's board. Rather than guess, the app walks
half-point lines outward from the projection and reports the last one on each side that
still clears the per-leg hit rate your entry size requires.

That turns "tell me what to play on PrizePicks" into something answerable: here is the
player, here is the number, take the over only at or below it. If neither side clears, the
prop is a pass, which is the correct answer more often than people expect.
