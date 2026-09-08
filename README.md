# WagerWise

An NBA-only tool for deciding which props and parlays are worth betting, built around the
apps in your rotation: PrizePicks, Underdog, Sleeper, Dabble, Chalkboard, Winible, Real,
ProphetX and Polymarket.

**It does not create an edge. It stops you acting on edges that are not there.**

That is the whole design brief. A projection built from season averages, compared against a
line the market has already priced, will happily report a fifteen percent edge that is
entirely an artefact of a thin input. This app refuses to produce that number.

Five things:

1. **Refuses to price what it cannot verify.** A prop with no sportsbook price behind it is
   marked unpriced, shown for context, and excluded from every expected-value calculation
   and from the optimizer. No exceptions.
2. **Captures the payout off your screen.** Stored payout tables drift. The multiplier the
   app displays while you build the entry is ground truth, so you read it in and confirm it
   before anything is priced, and it is stored with the slip.
3. **Prints the break-even hit rate beside every expected value.** If the break-even does
   not look like a plausible per-leg number, the multiplier is wrong and the expected value
   beside it is fiction.
4. **Shops the line and models correlation.** The same opinion is worth more on the app with
   the better number, and same-game legs are not independent.
5. **Keeps you honest.** Logs what the model predicted against what happened. This is the
   only part that can tell you the model is wrong.

Everything runs in your browser. No account, no database, no telemetry.

## Running it

```bash
git clone https://github.com/kingbobbywhite-blip/wagerwise.git
cd wagerwise
git checkout claude/nba-parlay-selector-zvbuzd
npm install
npm run dev
```

Open **http://localhost:3000** and press **Get today's picks**. Needs Node 20 or newer.

> The `git checkout` line is needed only until pull request #1 is merged. Everything
> lives on that branch; `main` still holds nothing but the original archive, so a plain
> clone has no `package.json` and `npm install` fails with `ENOENT`. Once the pull
> request is merged, drop that line.

### The API key

The app needs sportsbook prices. Get a key from
[the-odds-api.com](https://the-odds-api.com) (the free tier is 500 requests a month) and
put the **real key** in a `.env.local` file:

```bash
echo "ODDS_API_KEY=paste_your_real_key_here" > .env.local
```

You can paste it into Settings instead if you prefer; the environment variable takes
precedence. Without a working key the app has no prices, and it will say so rather than
invent an edge.

```bash
npm test         # 298 unit tests over the probability engine
npm run build
```

## What you get, every day

Press one button and the app pulls today's NBA games, prices every player prop it can,
and produces three things:

**Best single bets.** Offers where one book is priced better than the sharp consensus of
the others. The book being judged is always excluded from the consensus that judges it,
and at least one market-making book has to remain, otherwise a room full of copycats
becomes its own reference. Each row shows the price, the fair price, the edge and a
stake sized by fractional Kelly.

**Best parlays.** Built only from legs that are individually positive expected value,
and only within a single book, because a leg at DraftKings cannot be combined with a leg
at FanDuel onto one ticket. Correlation between legs is priced rather than ignored.

**Pick'em targets.** Nothing here can see what PrizePicks or Underdog are offering, so
instead you get the number to look for: the projection, the fair line, and the line at
which each side becomes worth taking. Open your app, find the player, and take the side
only if their number is at or beyond it.

Nothing is fetched until you press the button, and the result is cached, because player
props are billed per market per game and a page refresh that silently re-pulls the slate
is a refresh that costs money.

## Getting more data in

The daily pull covers the common markets automatically. These paths exist for when you
want something it does not pull, or want to work off a DFS board directly.

### Your own screenshots

Screenshot the board on your phone and drop the images into **Capture**. OCR runs entirely
in this browser, using a bundled engine and language model, so nothing is uploaded and no
app is scraped. Scraping a pick'em app's endpoints violates their terms and gets accounts
restricted, and the board is the half that carries no information anyway: it tells you what
is on offer, not what it is worth.

Capture the fifteen or so props you would genuinely consider rather than the whole board.
Every row lands in a review table and has to be ticked off by eye before it can be loaded,
and a shorter list gets checked properly.

You can also paste CSV, TSV, JSON, or plain text copied off a board.

After reviewing the rows, press **Attach sportsbook odds** to price them. Props that get a
price become priced; everything else stays unpriced and cannot be built into an entry.

### Feed settings worth knowing

Put Pinnacle first in the book list and keep `eu` in the regions, because Pinnacle sits in
that region and leaving it out silently removes the most useful price on the board.

Player props are billed **per market per game**. Four markets across a twelve-game slate is
48 credits for one refresh, so the free tier is about ten refreshes a month. Narrow the
market list rather than the book list: books are free, markets are not.

| Column (for pasted data) | Matters |
| --- | --- |
| `player`, `market`, `line` | Required. The line is the number your app is offering. |
| `book`, `over_odds`, `under_odds`, `book_line` | Without these the prop is unpriced. |
| `game_log`, `minutes_log` | Per-game values. Used only when no price exists. |
| `rest_days`, `teammates_out`, `projected_minutes` | Minutes context for the no-odds path. |
| `app`, `game_id`, `team`, `opponent` | Enables line shopping and same-game correlation. |

## The one number worth internalising

The per-leg hit rate you need just to break even, summed across every paying tier:

| Entry | Top pays | Break-even per leg | All-hit shortcut would say |
| --- | --- | --- | --- |
| Power 2-pick | 3x | 57.7% | 57.7% |
| Power 3-pick | 5x | 58.5% | 58.5% |
| Power 4-pick | 10x | 56.2% | 56.2% |
| Power 5-pick | 20x | 54.9% | 54.9% |
| Power 6-pick | 37.5x | 54.7% | 54.7% |
| Flex 3-pick | 2.25x | **59.1%** | 76.3% |
| Flex 4-pick | 5x | **56.9%** | 66.9% |
| Flex 5-pick | 10x | **54.3%** | 63.1% |
| Flex 6-pick | 25x | **54.2%** | 58.5% |

A 55% leg is a losing bet on most of these. "I hit 60% of my picks" is not the same as being
profitable, and a three-pick is harder to beat than a six-pick.

The right-hand column is what you get by raising the top multiplier to the power of minus
one over n, which is the shortcut almost every parlay calculator uses. It is correct for
all-or-nothing entries and wildly wrong for anything with partial-payout tiers, because it
ignores every dollar the lower tiers return. On a 3-pick flex it overstates the bar by
seventeen points, which is more than enough to talk you out of entries that are fine.

## Documentation

- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — how every number is computed.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what this cannot do, and where it can
  mislead you. Read this one before betting real money.

## Legal and practical

Sports betting and daily fantasy are regulated differently in every jurisdiction and are
not legal everywhere. Payout tables shipped here are **unverified defaults** and change
without notice. Nothing here is financial advice, and no model makes a negative-expectation
market profitable by itself.
