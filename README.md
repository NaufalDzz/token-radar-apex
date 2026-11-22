# token-radar-apex

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/NaufalDzz/token-radar-apex/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/NaufalDzz/token-radar-apex/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar Apex v4 ranks all 198 pre-token protocols in the 758-protocol DefiLlama snapshot by implied value (`40/40` watchlist + `138` early `<$50M` + `20` off-list), separating all `416` token-recording protocols and `144` house-rule exclusions cleanly. Each protocol's implied value is `TVL × Huber-robust size multiple (if a token launches) × conditional launch odds (peer survival) × family factor`, paired with an 8-step costed farm plan (`FARM` / `MARGINAL` / `SKIP`).

- **Part A, `fitValuationModel`**: Huber-robust (`delta = 0.65`) log-space regression of market cap ÷ family TVL over the `92` clean standalone traded tokens (`CE` / bridge / LST / wrapped exclusions removed). Candidate steps enter in a fixed order and stay only when they improve BOTH leave-one-out CV and chronological walk-forward error (`+ size curve, log TVL` and `+ Huber robust weights` kept; walk-forward miss **×2.21** vs **×4.54** flat; negative control fails both). Jackknife conformal LOO quantiles calibrate honest P25–P75 and P10–P90 ranges (`54%` and `74%` walk-forward coverage against stated `50%` and `80%`).
- **Part B, `fitTokenOddsModel`**: ridge logistic regression of "records a token" across `442` standalone protocols, mapping `59` undated protocols (`88%` token-recorded) to the oldest pre-tracking cohort (`5.1 yr`). All four signals (`age`, `category ridge 16`, `ln TVL`, `7-day TVL growth`) improve BOTH 10-fold CV and walk-forward Brier (**0.213** walk-forward vs **0.326** base rate; **73%** 10-fold accuracy; negative control fails).
- **Farm economics & compare workbench, `buildFarmPlan`**: 8 concrete, costed steps (`SETUP`, `VERIFY`, `FUND`, `RISK`, `CORE`, `CADENCE`, `EXIT RULE`, `RECORD & CLAIM`) selecting the lowest total 12-week cost chain (on-ramp/bridge + gas + category slippage), comparing net expected drop against both a 4% T-bill benchmark (`excess_vs_tbill_usd`) and `$25/h`, plus live portfolio rollup and side-by-side multi-protocol comparison.
- **One engine, checked twice**: `dashboard/model.js` is the single implementation. `main.ts` runs it in Node (via `lib/model.ts`) to emit `board.json`, `data.js`, and `dossier.json`; the browser refits `snapshot.json` live and verifies all `198` rows, monotonic ranks, summed implied value, and FNV-1a checksum (`checkBoardIntegrity`). Zero network requests; deterministic byte-identical runs.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
# then open out/dashboard/index.html  (?view=board | ?view=detail | ?view=filtered)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=52vz5va8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
