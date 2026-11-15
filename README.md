# token-radar-03

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anggiatlandoo/token-radar-03/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anggiatlandoo/token-radar-03/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Graveyard radar: the protocols most likely to never launch a token — and what you save by skipping them. The headline is the graveyard: 27 protocols with a probability of never launching of 0.60 or higher, each with its reasons stated (its category's launch record, its age, its size). Skipping them saves $91 of gas and 98.28 hours of hands-on work. The board of the best launches is the second view.

The value model is fitted, not hand-tuned: a log-log size curve (log10(mcap) = 3.2398 + 0.4928 × log10(TVL), R² 0.14, 119 live-token comps) gives the value if a protocol launches; an empirical launch-probability table (age × TVL, from the snapshot itself) gives the probability it launches, and P(never) = 1 − P(launch). Validated out of sample (LOO median miss ×3.34; time-split ×2.4; launch-probability calibration MAE 0.17). Each protocol's value is shown with a leave-one-out band, not a point.

Board: 198 rows (the full 40-protocol watchlist plus 158 rankable protocols), ranked by implied value — Sentora Curator $78.0M, Steakhouse Financial $77.9M, Gauntlet $59.2M at the top. Farm plans are netted (expected slice minus gas minus opportunity cost) with verdicts ROBUST 29 / FARM 55 / THIN 93 / SKIP 21 at a $1,000 tier, and every plan states the walk-away: the rise in TVL that takes its net to zero.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=4gqgrk6n&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
