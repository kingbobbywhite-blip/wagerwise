# WagerWise

An NBA-only tool for deciding which props and parlays are worth betting, built around the
apps in your rotation: PrizePicks, Underdog, Sleeper, Dabble, Chalkboard, Winible, Real,
ProphetX and Polymarket.

It does four things:

1. **Prices every line.** Strips the vig off any sportsbook price you supply, turns it into
   a projection, and re-evaluates that projection against the number your app is actually
   offering.
2. **Shops the line.** Groups every app's offer for the same player and stat, and tells you
   which one to take and what the difference is worth.
3. **Builds entries.** Searches for the combination that maximises expected value, expected
   bankroll growth, or probability of profit, against the real payout table for that app,
   with leg correlation modelled rather than ignored.
4. **Keeps you honest.** Logs what you bet and what the model predicted, then compares the
   two. This is the only part that can tell you the model is wrong.

Everything runs in your browser. No account, no database, no server. Your betting history
never leaves your machine.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 136 unit tests over the probability engine
npm run build
```

## Getting data in

The **Import** screen takes CSV, TSV or JSON and matches column names loosely, so most
scraper output works unchanged. Load the worked example to see the shape.

| Column | Matters |
| --- | --- |
| `player`, `market`, `line` | Required. The line is the number your app is offering. |
| `over_odds`, `under_odds`, `book_line` | The most valuable thing you can supply. |
| `projection` | Your own model, if you have one. |
| `l5`, `l10`, `season`, `minutes` | Recent form, used when no market price exists. |
| `hit_rate` | Accepts `7/10` or `70%`. Small samples are shrunk toward the model. |
| `app`, `game_id`, `team`, `opponent` | Enables line shopping and same-game correlation. |

A row with no odds, no projection and no form data is dropped rather than turned into an
invented coin flip.

## The one number worth internalising

On an all-or-nothing pick'em entry, the per-leg hit rate you need just to break even is:

| Entry | Pays | Break-even per leg |
| --- | --- | --- |
| 2-pick | 3x | 57.7% |
| 3-pick | 5x | 58.5% |
| 4-pick | 10x | 56.2% |
| 5-pick | 20x | 54.9% |
| 6-pick | 37.5x | 54.7% |

A 55% leg is a losing bet on most of these. "I hit 60% of my picks" is not the same as
being profitable, and a three-pick is harder to beat than a six-pick.

## Documentation

- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — how every number is computed.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what this cannot do, and where it can
  mislead you. Read this one before betting real money.

## Legal and practical

Sports betting and daily fantasy are regulated differently in every jurisdiction and are
not legal everywhere. Payout tables shipped here are **unverified defaults** and change
without notice. Nothing here is financial advice, and no model makes a negative-expectation
market profitable by itself.
