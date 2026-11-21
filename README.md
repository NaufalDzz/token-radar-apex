# token-radar-apex

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/NaufalDzz/token-radar-apex/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/NaufalDzz/token-radar-apex/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar Apex ranks the 196 pre-token protocols in a 758-protocol DefiLlama snapshot by implied value. Each protocol's implied value is TVL × fitted multiple (what its token would be worth if it launched) × token odds (how often similar protocols record a token) × family factor. It then costs out a farm plan for each one and gives a FARM / MARGINAL / SKIP verdict.

- **Part A, `fitValuationModel`**: log-space ridge regression of market cap ÷ family TVL over the 128 traded tokens. Candidate terms are added in a fixed order, and a term is kept only if it lowers both the leave-one-out and the walk-forward error. A negative-control term (another row's growth) has to fail, and it does. Walk-forward miss is ×2.56 against ×5.10 for a flat median. The P25–P75 and P10–P90 ranges are checked against held-out caps: 61% and 77% of newer caps fall inside them, against the stated 50% and 80%.
- **Part B, `fitTokenOddsModel`**: ridge logistic regression of "records a token" over 435 standalone protocols, scored by Brier on 10-fold cross-validation and walk-forward. Walk-forward Brier is 0.228 against 0.324 for the base rate.
- **`buildFarmPlan`**: six costed steps per protocol (setup, verify, core action, cadence, exit rule, claim) with gas on the cheapest chain, cost and time per step, and a net-of-fees result. Scenario controls set the deposit size, drop share and horizon.
- **One engine, checked twice**: `dashboard/model.js` is the only implementation. `main.ts` runs it in Node (through `lib/model.ts`) to write `board.json`. The page runs it again in the browser on the raw snapshot and confirms every rank, value and the FNV-1a checksum (the integrity ribbon). It makes no network requests, and two runs write identical bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
# then open out/dashboard/index.html  (?view=board | ?view=detail | ?view=filtered)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=52vz5va8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
