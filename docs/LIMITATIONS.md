# What this cannot do

Read this before betting real money. Every item here is a way the app can be confidently
wrong.

## 1. Payout tables are unverified defaults

This is the most dangerous item on the list, because it silently scales every expected-value
number in the app.

The multipliers shipped in `lib/quant/payouts.ts` are generic pick'em templates. They were
not read off a live app. Operators change them by state, by promotion and by sport, and
several products override them entirely for boosted picks (PrizePicks demons and goblins,
Underdog boosts). Winible and Real in particular ship placeholder tables because their
structures were not available to confirm.

If the real 4-pick pays 8x and the app assumes 10x, a "+15% EV" entry is actually about
−8%. **Check the live payout in the app and correct the table in settings before you trust
any EV figure.**

## 2. There is no data feed

The app prices whatever you give it. It does not scrape PrizePicks, Underdog or anyone else,
and it should not: those endpoints are not public APIs, automated access generally violates
their terms, and accounts get restricted for it.

That leaves you entering data manually or running your own collection. It is the honest
constraint, and it is the main friction in daily use.

## 3. Without a sportsbook price, the projections are weak

The engine's real strength is stripping vig off a two-way market and re-evaluating that
opinion at your app's number. Supply `over_odds` and `under_odds` and the projections are
grounded in the sharpest free signal available.

Supply only season and recent averages and you get a naive form projection that ignores
opponent, pace, rest, injuries to team-mates, blowout risk and role changes. The app marks
these lower confidence and widens their outcome spread, but low confidence is not the same
as correct. Expect little genuine edge from form-only inputs.

## 4. Injuries, rest and rotations are not modelled

There is no news feed. A star ruled out ninety minutes before tip changes every team-mate's
projection, and the app will not know. The minutes-projection column is the only lever, and
it requires you to already know.

Do not bet a slate the app priced before the inactives were posted.

## 5. Dispersion ratios are priors, not measurements

The variance-to-mean ratios per market are reasonable NBA-wide values. They are not
player-specific. A high-volume, low-variance role player and a streaky shooter with the same
average get the same spread, which is wrong in both directions.

The tracker's calibration table is what catches this. If the model is systematically
overconfident, widen the outcome spread in settings.

## 6. Correlations are structural priors, not fitted

The correlation values come from how basketball works, not from a fitted covariance matrix
on real game logs. They are directionally right and conservatively sized, but a specific
pairing could be materially off. When the assembled matrix is not a valid covariance matrix
it is shrunk toward independence, and any entry that needed heavy shrinkage says so.

## 7. Beam search does not guarantee the optimum

The optimizer explores a wide but not exhaustive set of combinations. On a large slate the
true best entry may be missed. In practice the top handful are near-identical in value, so
this costs little, but "max expected value" means "best found", not "provably best".

## 8. Monte Carlo numbers wobble

Entries are simulated 25,000 times. Two expected-value figures within about half a
percentage point of each other are not meaningfully different. Do not choose between entries
on a 0.3-point gap.

## 9. The edge on these apps is thin and structural

DFS pick'em products are priced so the house wins on average. There are only three real
sources of edge:

1. **Line shopping.** The same opinion is worth more on the app with the better number. This
   is the most reliable edge available and requires no model at all.
2. **Stale or soft lines.** The DFS app has not moved with the market yet.
3. **Correlation the payout table does not price.**

Nothing in this app manufactures edge from a fairly priced line. If the board shows nothing
clearing break-even, the correct action is to bet nothing, and it will say so.

## 10. Results take a long time to mean anything

At a 5% edge with typical parlay variance, hundreds of entries are needed before profit and
luck can be told apart. A losing month proves nothing. A winning month proves nothing
either. Calibration converges faster than profit, which is why the tracker leads with it.

## 11. Everything lives in one browser

There is no server and no account. Clearing site data deletes your history. Export from the
settings screen regularly.

## 12. Exchange and prediction-market support is partial

ProphetX and Polymarket are modelled in the payout registry but the build screen currently
optimises DFS pick'em entries only. Their prices can be imported and priced on the board;
they cannot yet be assembled into optimised entries.
