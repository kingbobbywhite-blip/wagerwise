# WagerWise

A basketball and football tool for deciding which props and parlays are worth betting, built around the
apps in your rotation: PrizePicks, Underdog, Sleeper, Dabble, Chalkboard, Winible, Real,
ProphetX and Polymarket.

Three leagues: **NBA**, **WNBA** and **NFL**. Pick one with the tabs on
the Today screen. Each keeps its own cached pull, so switching leagues never throws away a
slate you already paid feed credits for.

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
npm install
npm run dev
```

Open **http://localhost:3000**, pick a league tab, and press **Get today's picks**.

**Node 22 or newer is required** (`.nvmrc` pins it; `nvm use` picks it up). Node 20 will
install and appear to work, but CI builds on 22 and some transitive dependencies refuse to
run below it.

### Updating an existing clone

```bash
git pull origin main
npm install
npm run dev
```

If a pull ever aborts complaining about local changes to a generated file, discard it and
retry — nothing generated is worth keeping:

```bash
git checkout -- next-env.d.ts && git pull origin main
```

If `npm install` reports packages that are not in `package.json` (Supabase, for example),
the `node_modules` directory is stale from something else. Wipe and reinstall:

```bash
rm -rf node_modules && npm install
```

### Deploying

`main` is the production branch. With Vercel's Git integration connected, every push to
`main` deploys itself; otherwise deploy by hand from a clone:

```bash
npx vercel --prod
```

Leave `ODDS_API_KEY` unset in Vercel unless the deployment is password-protected. A public
URL with a server-side key lets anyone who finds it spend your feed quota. Entering the key
in Settings instead keeps it in your own browser.

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
npm test         # 416 unit tests over the probability engine and screenshot reading
npm run build
```

## What you get, every day

Pick a league, press one button, and the app pulls today's games, prices every player prop
it can, and produces three things:

**Best single bets.** Offers where one book is priced better than the sharp consensus of
the others. The book being judged is always excluded from the consensus that judges it,
and at least one market-making book has to remain, otherwise a room full of copycats
becomes its own reference. Each row shows the price, the fair price, the edge and a
stake sized by fractional Kelly.

**Best parlays.** Built only from legs that are individually positive expected value,
and only within a single book, because a leg at DraftKings cannot be combined with a leg
at FanDuel onto one ticket. Correlation between legs is priced rather than ignored.

**Pick'em targets.** Nothing here can see what PrizePicks or Underdog are offering, so
type in the line your app shows for a player and you get one answer: the over, the under,
or pass. Never both. Value bets likewise show one side per player and stat: an over at one
book and an under at another is a middle, not two picks, and on a pick'em app one of the
two always loses.

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
| Power 3-pick | 6x | 55.0% | 55.0% |
| Power 4-pick | 10x | 56.2% | 56.2% |
| Power 5-pick | 20x | 54.9% | 54.9% |
| Power 6-pick | 37.5x | 54.7% | 54.7% |
| Flex 3-pick | 2.25x | **59.1%** | 76.3% |
| Flex 4-pick | 5x | **56.9%** | 66.9% |
| Flex 5-pick | 10x | **54.3%** | 63.1% |
| Flex 6-pick | 25x | **54.2%** | 58.5% |

A 55% leg is a losing bet on most of these. "I hit 60% of my picks" is not the same as being
profitable, and a two-pick is the hardest of them all to beat.

These are standard picks. Goblins and demons change every tier: a real 6-pick flex of five
goblins and a demon hit five of six and paid **0.5x**, where the table above pays 2x. That is
why the tracker scores a logged entry at what the app actually paid, not at a table.

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

## Leagues

| | NBA | WNBA | NFL |
|---|---|---|---|
| Feed sport key | `basketball_nba` | `basketball_wnba` | `americanfootball_nfl` |
| Default markets | pts, reb, ast, 3pm | pts, reb, ast, 3pm | pass yds, rush yds, rec yds, receptions |
| Default game cap | 14 | 8 | 14 |
| Volatility prior | baseline | +5% | its own markets |

For the two basketball leagues, the **prior mean** is scaled for the WNBA's shorter, slower
game, and it is used only when no book has priced the prop: a real market price always wins.
The WNBA **volatility prior** widens the distribution slightly, which pulls probabilities toward
a coin flip.

The NFL uses its own markets rather than scaled basketball ones. Yardage is modelled as a
right-skewed count (a 70-yard catch happens, a minus-70 one does not), with a spread near 70
yards on a 250-yard passing line, near 29 on a 65-yard rushing line and near 31 on a 60-yard
receiving line. Passing touchdowns and interceptions are less variable than a Poisson count.
Touchdowns, completions, attempts, carries, interceptions and rush + rec yards are all mapped;
add their feed keys under Settings → Markets to pull them. Anytime and first-touchdown props are
yes/no prices with no line and are not modelled.

The probability at a line a book has actually priced is identical in every league. That is
deliberate and there is a test pinning it: when the market has spoken, a league prior that
moved the number would be inventing an edge.

### NFL notes

Most days have no NFL games. The slate is Sunday, plus Thursday and Monday nights, and the
Today screen names the next game when today has none. Props are posted days ahead and move
hard on injury and weather news, so pull on game day. A full Sunday at the default four
markets is about 56 credits, the same as a full NBA night.

The feed does not say which team a player is on. A quarterback and his own receiver are
therefore linked only as players in the same game, not as a stack, so the correlation between
them is understated for same-team legs and overstated for opponents.

College basketball was removed. A phone that still has it selected opens on the NBA.
