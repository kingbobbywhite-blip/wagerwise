# WagerWise

A basketball, football and hockey tool for deciding which props and parlays are worth betting, built
around the apps in your rotation: PrizePicks, Underdog, Sleeper, Real and Winible for pick'em, FanDuel
as the one sportsbook, and ProphetX and Polymarket.

Sportsbook bets and parlays are only ever recommended at FanDuel. Pinnacle, BetOnline, LowVig,
DraftKings and the rest are pulled to price the market and never shown as the place to bet.
Add a book under Settings if you open an account there.

Three tabs: **NBA**, **NFL** and **NHL**. **College football rides inside the NFL tab**, off by
default: turn the switch on under Settings → Today and one press pulls both, each priced with its
own numbers, with a college row badged CFB wherever it appears — and because that press costs 80
credits rather than 56, the button asks before spending it. Each tab keeps its own cached pull, so
switching never throws away a slate you already paid feed credits for.

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

**Two feeds can price the slate.** [The Odds API](https://the-odds-api.com) carries Pinnacle's
player props and bills per market per game against 500 credits a month.
[PropLine](https://prop-line.com) bills per request against 1,000 a day and also carries the
lines **PrizePicks and Underdog are actually posting**. Pick the provider under Settings → Odds
feed. A PropLine key also works alongside The Odds API: Pinnacle prices the props, PropLine
supplies the pick'em apps' lines, and the pick'em entry is built at the line your app shows.

## Running it

**Node 22 or newer is required.** Check with `node -v`; if it says v20 or lower, install the
current LTS from [nodejs.org](https://nodejs.org) (or `nvm install 22`, since `.nvmrc` pins it).
Node 20 reached end of life in April 2026 and no longer gets security fixes, so npm is set to
stop with an `EBADENGINE` error rather than install on it.

```bash
git clone https://github.com/kingbobbywhite-blip/wagerwise.git
cd wagerwise
npm ci
npm run dev
```

Open **http://localhost:3000**, pick a league tab, and press **Get today's picks**.

`npm ci` installs exactly the versions in `package-lock.json`, the ones CI has checked, and
never rewrites that file. `npm audit` should report 0 vulnerabilities.

The dev server only answers on this computer (127.0.0.1). It holds any key in `.env.local`,
so other devices on your Wi-Fi are kept out. To open it from your phone on the same network
anyway, start it with `npx next dev -H 0.0.0.0`, and only on a network you trust.

### Updating an existing clone

```bash
git pull origin main
npm ci
npm run dev
```

If a pull aborts with "Your local changes to the following files would be overwritten" and
names `package-lock.json`, an `npm install` rewrote it. Nothing in it is worth keeping, so
discard it and retry:

```bash
git checkout -- package-lock.json && git pull origin main
```

If `npm ci` reports packages that are not in `package.json` (Supabase, for example), or
anything else odd, the `node_modules` directory is stale. Wipe and reinstall:

```bash
rm -rf node_modules && npm ci
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

The feed routes only answer JSON requests from the app's own pages, so another website open
in your browser cannot spend a key held in `.env.local` through your local server. That does
not protect a public URL from someone calling it directly, which is why the advice above
stands.

### The API key

The app needs sportsbook prices. Get a key from
[the-odds-api.com](https://the-odds-api.com) (the free tier is 500 requests a month).

The simplest place for it is **Settings → Odds feed** in the running app: paste it there and
it is kept in your browser. To keep it in a file instead, copy the example file and put the
**real key** after the `=` in a text editor:

```bash
cp .env.example .env.local        # Windows: copy .env.example .env.local
```

Restart the app after editing `.env.local` so it picks the key up; a key there takes
precedence over one in Settings. Avoid `echo KEY=... > .env.local` in Windows
PowerShell 5: it writes the file as UTF-16, and the key in it is never read. Without a
working key the app has no prices, and it will say so rather than invent an edge.

Optionally add a [PropLine](https://prop-line.com) key (free, 1,000 requests a day) to read the
pick'em apps' own lines, or to price the whole slate from PropLine instead. It goes in the
same Settings tab, or on the `PROPLINE_API_KEY=` line of `.env.local`.

The same caution about public deployments applies: leave `PROPLINE_API_KEY` unset on an
unprotected URL and enter the key in Settings instead.

**"PropLine rejected the API key"** means PropLine received a key and did not recognise it,
so the fix is the key itself, not the app. The message names where the key it sent came
from. Three things cause it:

- The key is wrong, revoked, or from somewhere else. Check it against the one on
  [prop-line.com](https://prop-line.com); an Odds API key is not a PropLine key, and the two
  fields in Settings are not interchangeable.
- `PROPLINE_API_KEY` in `.env.local` holds something stale, and it takes precedence over
  Settings, so retyping the key in Settings changes nothing. Correct it in the file, or
  delete the line and restart. A placeholder such as `your_api_key` is ignored rather than
  sent, so it can no longer shadow a real key in Settings.
- The key was pasted with a newline or wrapping quotes. Those are stripped now, but the
  PowerShell 5 UTF-16 trap above still applies.

```bash
npm test         # 644 unit tests over the probability engine, the feeds and screenshot reading
npm run lint
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

**Pick'em entry.** The likeliest targets that clear the bar: one leg per player, at most two
per game, with the chance they all hit and the expected return at your default app's payout
table. With a PropLine key the legs are at the line your default app is actually posting, and
a prop it is not offering is left out; without one they are at the books' own line, which the
pick'em apps almost always copy. If too few clear, it says so rather than padding the entry
with coin flips.

**Pick'em targets.** With a PropLine key, the lines PrizePicks and Underdog are posting are
listed under each player with the chance of each side, priced off the sportsbooks, and your
default app's line is filled in. Without one, nothing here can see what the apps are offering,
so type in the line your app shows. Either way you get one answer: the over, the under, or
pass. Never both. Value bets likewise show one side per player and stat: an over at one
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

## A name is not an identity

Across 130 college teams, two different players sharing a normalised name in one slate is
ordinary rather than freakish. Every map in the app used to be keyed on the name alone, which
fused them: six books pooled into one consensus and a line that was wrong for both. Player
identity is now name **and game**, in the quote grouping, the one-decision-per-prop rule, the
optimizer's one-leg-per-player constraint, the board's row grouping and the pick'em entry. The
same name in two games is also no longer the same player to the correlation model, where it was
pricing two unrelated legs as one event.

The pick'em lines still match by name, because they arrive from a different feed than the prices
and the two spell teams differently — but a line from the same fixture wins, matched on team
nicknames, and when a name is shared and no line can be tied to the fixture, nothing is shown and
the row says why. An imported board carries a name and a stat with usually no fixture, so there
the ambiguity is reported rather than resolved.

## What gets left out, and why you can see it

Two things are hidden from the pick'em targets, and both are counted and nameable on screen:

**Props too lopsided for a board.** A flat payout table only works if both sides of a pick are
plausible, so an app does not post a prop whose favoured side is a near-certainty however happily
a sportsbook prices one. The ceiling is a dial in Settings (default 80%), what it removes is
listed by name under the targets with the reason, and a line PropLine shows an app actually
posting is never removed by it.

**Lines no board shows.** The thresholds and the probability ladder cover the lines the books are
actually hanging, widened half a standard deviation, instead of sweeping a fixed window around the
projection.

## The path to fitting the priors

Three numbers in this app are reasoned rather than measured, and they are labelled as such
wherever they appear: the kickoff widening (4% of variance per day), college football's volatility
multiplier (1.2) and the yardage spread floors. Fitting them needs data the app now collects.

**The tracker reads settled legs along three axes**, not one: by predicted probability band as
before, and now by competition and by market. Each row prints the variance multiplier that would
reconcile what the model said with what happened — the number to move the outcome-spread slider
toward. One axis at a time on purpose: competition by market by probability band is thirty cells
and a hundred settled legs would put five results in each.

That readout **cannot fit the kickoff widening**, and says so. A settled leg's stored probability
already had the widening applied, so comparing it to the result measures what is left after the
correction rather than the correction itself.

**What can fit it is the line history.** Each pull keeps one compact row per prop — the consensus
line, the implied mean and how many books posted it, about 190 bytes, not a copy of the quotes —
and the same prop seen twice at different distances from kick-off gives the spread of the move,
which is exactly the uncertainty the widening prices. The tracker prints the measured variance per
day beside the 4% in use, and counts its pairs out loud rather than quietly fitting six of them.

**It measures hours, not days, and that is a real limit.** Today pulls from local midnight to 11am
tomorrow, so a Sunday afternoon game cannot be pulled on Saturday at all: two looks at one prop can
be hours to about a day apart, never the four days a midweek NFL line actually drifts over. What
the readout shows is the last day's movement scaled to a day, which is a lower bound on the week's.
Closing that gap means a wider pull window, which means more games and more credits per press — a
choice for whoever is paying, not a default worth slipping in.

Legs logged before a competition was recorded sit in their own row. A leg keeps no game and no
start time, so nothing can work out afterwards whether it was a college prop or an NFL one, and
folding them into a guess would report college legs as NFL calibration.

## When the browser runs out of room

Everything lives in this browser's localStorage, which browsers cap per site: Chrome takes about
5.2 million characters, and Safari's 5MB allowance is no larger. A pull used to be stored
verbatim, every quote repeating its team names, game and kick-off, so a 14-game NFL Sunday at
eight books ran to millions of characters, enough to fill the allowance nearly alone. The old shed
loop then dropped the line history, every other slate, the imported board and finally the pull
itself, from the screen as well as from storage.

Three changes fix that:

- **Pulls are packed.** Quotes and the line history are stored by column, with each repeated
  string kept once (`lib/store/pack.ts`). A full NFL Sunday drops from millions of characters to
  about 220,000, losslessly. Exports stay unpacked and readable.
- **The state is stored in pieces.** Settings and slips have their own key, each league's slate
  another, the line history and imported board theirs. A save writes only what changed, so a
  setting no longer re-serialises every slate, and a slate that does not fit can never stop a slip
  from being saved.
- **A full quota trims storage, never the screen.** If something still does not fit, the stored
  copy sheds in order (older line history, other leagues' slates oldest first, the rest of the
  history, the imported board, the newest pull last). What is on screen stays whole until the
  tab is closed, and a banner names exactly what will not survive a reload. Slips are never shed.

Settings → Data shows what each piece takes and lets you clear a slate, the history or the board,
with an undo.

## Leagues

| | NBA | NFL | CFB | NHL |
|---|---|---|---|---|
| Tab | NBA | NFL | inside NFL, opt-in | NHL |
| Feed sport key | `basketball_nba` | `americanfootball_nfl` | `americanfootball_ncaaf` | `icehockey_nhl` |
| Default markets | pts, reb, ast, 3pm | pass yds, rush yds, rec yds, receptions | same as the NFL | shots on goal, points, saves, blocked shots |
| Default game cap | 14 | 14 | 6 | 12 |
| Volatility prior | baseline | its own markets | +20% on the NFL's (unfitted) | its own markets |
| One default press | 56 credits | 56 credits | +24, and +1 to rank them | 48 credits

The **prior mean** is used only when no book has priced the prop: a real market price always
wins. A **volatility prior** above baseline widens the distribution, which pulls probabilities
toward a coin flip — the honest response to a less predictable league.

The WNBA was removed. A phone that still has it selected opens on the NBA, and a settled WNBA
entry in the tracker still reads back off a screenshot.

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
markets is about 56 credits, plus 24 for the college games pulled with it, and the Today screen
shows that total before you press the button.

Two things make the numbers here more honest than a dispersion ratio alone:

**The button asks before an expensive press.** Above 15% of a 500-request month — 75 credits, six
presses from an empty month — the pull is a confirm rather than a note beside the button, because a
note is read after the credits are gone. The figure is summed per competition, since each can be
asked for a different market list and credits are billed per market per game. A full Sunday with
college football switched on is 80 credits, so that press asks; the NFL alone, at 56, does not.

**Yardage carries a floor on its relative spread.** A ratio prior implies that the spread
grows with the square root of the projection, so a 340-yard passing line came out with a
standard deviation of 80 yards — 24% of the mean, where a real passing line sits near 28%.
Every probability built on that was too confident, and an overconfident probability is a
phantom edge. Passing, rushing, receiving and rush+rec yards now get the wider of the ratio
prior and a floor of 27%, 45%, 52% and 45% of the projection. Below the crossover the ratio
still governs, because a low-volume receiver really is more erratic than a proportional
spread allows.

**A line priced days before kickoff is widened for the days in between.** Four percent of
variance a day, capped at twelve percent. The price was right for what was known on Tuesday;
what Sunday's injury report will say is real uncertainty and belongs in the distribution
rather than in a footnote. On a slate pulled the same evening it changes nothing.

The feed does not say which team a player is on. A quarterback and his own receiver are
therefore linked only as players in the same game, not as a stack, so the correlation between
them is understated for same-team legs and overstated for opponents.

### College football notes

CFB is a companion of the NFL tab, not a tab of its own: same sport, same markets, same
weekend, and the pick'em apps put both on one board. It is pulled in the same press, capped at
six games because a Saturday lists fifty and only the televised ones carry real prop pricing,
and priced with its own numbers rather than the NFL's:

- **20% wider at the same projected mean.** The talent gap between the two rosters is often
  enormous, starters sit out the fourth quarter of a blowout, and the backfield split is far
  less knowable than in the NFL. All three widen the outcome, and a wider outcome means a
  probability closer to a coin flip.
- **Its own plausibility ceilings**, because a 500-yard passing game and a 300-yard rushing
  game both happen in college football and NFL ceilings would flag real outcomes as impossible.

**Which six games get the cap is chosen, not taken in start order.** A Saturday lists fifty and
the earliest kick-off is as likely to be a game no book prices as the one everyone does, so one
sport-level call for spreads — billed per market per region, so a single credit whatever it
returns — says who the books are actually pricing. Games are ranked by how many books hang a
spread, ties to the closer game, and anything over 21 points is skipped because a four-touchdown
favourite benches the players a yardage prop is on. That is also why the section asks for all four
football markets rather than a trimmed pair: the games it selects are the televised ones, which are
exactly the games where receptions and receiving yards exist. If the ranking call fails the slate
falls back to start order and says so, and what it did is reported on screen so a thin board reads
as expected rather than broken.

Most of a Saturday slate comes back unpriced and is correctly left out: no sportsbook price,
no expected value, no exceptions.

### NHL notes

Why the NHL was added: it is where a pick'em app's even-money payout is most often wrong.
Hockey props are small counts on half-point lines. A skater averaging 2.9 shots goes over 2.5
about 56% of the time; a depth forward's under 0.5 points is often priced near -250, a 70% leg.
The books price one side well past a coin flip, and the pick'em app pays it as if it were one.
Pinnacle prices the main NHL props, the season runs from October to April, and a normal night
has about ten games. None of that guarantees a profit: it is the market where an edge shows up
most often, not one where it always does.

Hockey markets are their own (shots on goal, goalie saves, points, assists, goals, blocked shots,
power-play points), modelled as near-Poisson counts, with saves wider. "Points" and "Assists" on
a PrizePicks NHL screen are read as the hockey stats when the entry is an NHL one. Starting
goalies are confirmed late, and a backup in net moves every save line and the other team's
shots, so pull close to puck drop. Hits, faceoffs and time on ice are logged but not priced.

**The NHL board used to fill with picks you could not place anywhere.** Two causes, both fixed:

1. **Markets no pick'em app posts.** Goals and power-play points are priced by the books at
   0.5 against a mean near 0.25, so the favoured side is an 80% under. Sorted by hit rate,
   those came out on top of every NHL board. No pick'em app offers a prop that lopsided — the
   payout table only works if both sides are plausible — so the default pull is now the four
   markets PrizePicks, Underdog and FanDuel all post: shots on goal, points, goalie saves and
   blocked shots. Goals and power-play points stay mapped for reading a logged entry, and can
   be added back under Settings → Markets. A target whose every posted line is more lopsided
   than 80/20 is dropped from the pick'em section whatever the league, and the value-bet side
   of the app still prices it.
2. **Lines no board has ever shown.** The thresholds and the probability ladder used to sweep
   a fixed window around the projection, which gave a 0.4-assist market lines up to 16.5 and a
   27-save goalie lines down to 11.5. The search now covers the lines the books are actually
   hanging, widened half a standard deviation for an app that hangs a slightly different
   number. The same fix cuts a 250-yard passing ladder from two hundred rows to fifty.

College basketball and the WNBA were removed. A phone that still has one selected opens on
the NBA.
