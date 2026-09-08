# What this cannot do

Read this before betting real money.

## The honest summary

This app does not create an edge. It stops you acting on ones that are not there.

Everything it does well is subtractive: refusing to price props with no market behind them,
forcing you to read the payout off your own screen, printing the break-even next to every
expected value, marking retail-only prices as weaker than sharp ones. None of that finds you
money. It stops you giving money away to your own bad inputs.

**A +15% expected value reading is almost always a bad input.** In that order of likelihood:
a mistyped payout multiplier, a stale sportsbook price, a prop matched to the wrong player, a
line that already moved on injury news, a game log that includes minutes the player will not
see tonight. Genuine edge on these products lives in the low single digits, and it is rare.
When the app shows you a large number, the correct first response is suspicion, and the app
now says so on the card.

**The real edges are stale lines, and using them gets you limited.** The reliable ways to beat
a pick'em app are taking a number the operator has not moved yet, and taking the better of two
numbers across two apps. Both work. Both are also exactly what operator risk teams look for,
and consistently doing either gets your account restricted, your limits cut, or your entry
sizes capped. That is not a flaw in the strategy. It is the business model, and any plan that
assumes indefinite access at current limits is wrong.

## 1. Payout tables still have to be checked by a human

The capture step fixes the mechanism but not the diligence. If you confirm a payout you did
not actually read off the screen, everything downstream is wrong and confidently so. The
break-even figure beside each expected value is the safety net, so look at it.

Boosted picks (PrizePicks demons and goblins, Underdog boosts) change both the multiplier and
the implied probability of the pick itself. The app models the multiplier if you type it in.
It does not know the pick was boosted.

## 2. Injuries, rest and rotations are still not modelled

There is no news feed. A star ruled out ninety minutes before tip changes every team-mate's
projection, and the app will not know. The minutes context on the no-odds path is a manual
lever that requires you to already know.

A sportsbook price *does* reflect news, which is another reason the priced path is worth so
much more than the game-log path. But a price captured before the news is stale, and stale is
worse than absent. Set the discard threshold low and re-pull close to tip.

## 3. OCR is wrong often enough to matter

Reading a dense mobile screenshot is not reliable. Decimal points vanish, `0` becomes `O`,
long names truncate. Every OCR row is unconfirmed until you tick it, and the app will not load
a slate with unreviewed rows. That gate only works if you actually look. Capturing fifteen
props you would genuinely consider, rather than the whole board, is what makes reviewing them
properly realistic.

Player names are matched to feed quotes exactly, never fuzzily. Attaching Jalen Williams'
price to Jaylin Williams would be far worse than leaving the prop unpriced, so unmatched names
are reported rather than guessed.

## 4. The daily picks are sportsbook bets, not pick'em picks

The automatic flow finds mispriced offers **on sportsbooks**, because that is the only
place prices can be read from. It cannot tell you what to play on PrizePicks, because it
cannot see PrizePicks.

The pick'em targets are the bridge: a number to check against your own screen. That is a
real answer, but it is not the same as the app placing the pick for you, and no amount of
engineering makes it one without either scraping their board or you typing it in.

## 5. The odds feed costs money and burns quota fast

Player props are billed per market per event. Fourteen markets across a twelve-game slate is
168 credits for one refresh. Narrow the market list to what is on your board, narrow the book
list to the ones that carry weight, and expect to re-pull before tip rather than continuously.

If the feed fails, props stay unpriced and the optimizer refuses to build. That is the
intended behaviour, not a bug.

## 6. Dispersion ratios are priors, not measurements

The variance-to-mean ratios per market are reasonable NBA-wide values, not player-specific
ones. A steady role player and a streaky shooter with the same average get the same spread
unless you supply a game log. The tracker's calibration table is what catches this.

## 7. Correlations are structural priors, not fitted

The correlation values come from how basketball works, not from a fitted covariance matrix on
real game logs. They are directionally right and conservatively sized, but a specific pairing
could be materially off. When the assembled matrix is not a valid covariance matrix it is
shrunk toward independence, and any entry that needed heavy shrinkage says so.

## 8. Beam search does not guarantee the optimum

The optimizer explores a wide but not exhaustive set of combinations. "Max expected value"
means "best found", not "provably best".

## 9. Monte Carlo numbers wobble

Entries are simulated 25,000 times. Two expected-value figures within about half a percentage
point are not meaningfully different. Do not choose between entries on a 0.3-point gap.

## 10. Results take a long time to mean anything

At a 5% edge with typical parlay variance, hundreds of entries are needed before profit and
luck can be told apart. A losing month proves nothing. A winning month proves nothing either.
Calibration converges faster than profit, which is why the tracker leads with it, and the
headline calibration figure stays neutral until roughly a hundred legs have settled.

## 11. Everything lives in one browser

No server, no account. Clearing site data deletes your history. Export from settings
regularly.

## 12. Exchange and prediction-market support is partial

ProphetX and Polymarket are modelled in the payout registry, and their prices can be imported
and shown on the board, but the build screen optimises DFS pick'em entries only.

## 13. The odds feed does not say which team a player is on

Correlation between legs in a daily parlay is detected at game level, not team level. Two
team-mates in the same game are correctly treated as correlated through pace, but the
usage competition between them, and the assist-to-scorer link, are invisible. Slates
captured with team columns do get the full model.

## 14. Legality varies

Sports betting and daily fantasy are regulated differently in every jurisdiction and are not
legal everywhere. Nothing here is financial advice.
