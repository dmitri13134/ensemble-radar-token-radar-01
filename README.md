# Ensemble Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dmitri13134/ensemble-radar-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dmitri13134/ensemble-radar-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty. It reads the
sealed DefiLlama snapshot, scores every pre-token protocol on five
independent signals, and ranks them by an implied value: TVL priced at
the multiple its own category's tokened peers actually trade at, tilted
by the ensemble score.

## The idea

One signal can lie. A protocol can be huge and shrinking, young and
surging, or broad and flat. So each protocol gets five scores, 0–100,
each from the snapshot alone:

- **Scale** — log10 of TVL between $5M and $100B.
- **Momentum** — 7-day TVL change, clamped to −30%…+60%.
- **Tenure** — days listed with no token recorded, over 3 years.
- **Breadth** — chain count, one chain scoring 35, doubling toward 100.
- **Peer** — the category's median mcap/TVL multiple against the global median.

The ensemble blends them (scale 30, momentum 20, tenure 15, breadth 10,
peer 25). The implied value is `TVL × category peer multiple × (0.55 +
0.45 × ensemble/100)`. When the five signals disagree, the row says so:
**agree** (spread under 25), **mixed** (25–50) or **split** (over 50).

The board covers all 40 watchlist protocols plus the 260 strongest
early finds below the watchlist floor — pre-token protocols the floor
leaves out. Protocols whose token already trades are never ranked; they
appear separately as the peer set the multiples come from. No protocol
name is ever special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/`, and writes
`dossier.json` with the vendored make.fun library. The dashboard is a
static page with no network: search, category/chain/consensus filters,
a minimum-ensemble slider, five sort orders, a detail view per protocol
with its five signal bars and a five-step farm plan with costs and
times, and a live-peers table.

## Files

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/ensemble.ts` — the five-signal model, the board builder, farm plans.
- `dashboard/` — `index.html`, `app.css`, `app.js` (no framework, no network).
- `screenshots/` — board, detail view, filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library.
