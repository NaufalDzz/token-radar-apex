/* Launch Radar Apex: one self-contained model run twice. main.ts runs it in Node to write board.json; the browser
 runs the exact same file on snapshot.json and verifies every row and FNV-1a checksum against board.json. No protocol
 name is hardcoded anywhere: every coefficient is fitted on the snapshot and kept only if it beats both held-out tests.
 implied value = TVL x fitted multiple (if a token launches) x conditional launch odds (peer survival) x family factor */
(function (root) {
'use strict';
const L10 = Math.log10, clip = (v, a, b) => Math.min(b, Math.max(a, v));
// Exact house-rule exclusions from the snapshot specification.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/, WRAPWORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const BRIDGE = ['Bridge', 'Canonical Bridge'], LST = ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'];
const TERMS = { size: '+ size curve, log TVL', fam: '+ category family (ridge 16)', cat: '+ category effect (ridge 16)', mom: '+ 7-day TVL growth', age: '+ age, years listed', ch: '+ chain count, log', ctrl: "+ control: another row's 7d" };
const L_FAM = 16, L_CAT = 16, BOOT = 160, SEED = 20261114;
const recorded = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
/** House-rule exclusion bucket, or null for standalone DeFi protocols. */
const ruleOut = (p) => p.category === 'CEX' || EXCHANGE.test(p.name) ? 'cex' : BRIDGE.includes(p.category) ? 'bridge' : LST.includes(p.category) ? 'lst'
  : VERSIONED.test(p.name) || WRAPWORD.test(p.name) ? 'wrap' : null;
/** Coarse sector family derived purely from the category string. */
function catFamily(cat) {
  const c = (cat || 'Other').toLowerCase();
  if (/dex|amm|swap|liquidity|pool|farm/.test(c)) return 'DEX & Liquidity';
  if (/lend|borrow|credit|cdp|stable|collateral|basis/.test(c)) return 'Lending & Credit';
  if (/deriv|perp|option|predict|synthet/.test(c)) return 'Derivatives';
  if (/yield|vault|curator|allocator|restak|staking/.test(c)) return 'Vaults & Yield';
  if (/rwa|payment|insur/.test(c)) return 'RWA & Finance';
  if (/chain|rollup|l2/.test(c)) return 'Chains & Infra';
  return 'Other DeFi';
}
const first = (n) => n.toLowerCase().split(/[\s\-.]+/)[0];
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y), i = q * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const byListing = (a, b) => (a.listed_at ?? '') < (b.listed_at ?? '') ? -1 : (a.listed_at ?? '') > (b.listed_at ?? '') ? 1 : a.slug < b.slug ? -1 : 1;

/** Partitions all 758 snapshot protocols into exactly one bucket for full accounting. */
function classifyProtocols(s) {
  const wl = new Set(s.watchlist);
  return s.protocols.map((p) => {
    const ro = ruleOut(p);
    if (recorded(p)) return !ro && p.mcap_usd > 0 ? 'trade' : 'recorded';
    if (wl.has(p.slug)) return 'watch';
    if (ro) return ro;
    return p.tvl_usd >= s.floor_usd ? 'off' : 'early';
  });
}

/** Per-protocol model features read strictly from snapshot fields. */
function features(s, ageFill) {
  const asOf = Date.parse(s.as_of + 'T00:00:00Z'), n = s.protocols.length;
  return s.protocols.map((p, i) => {
    const ageDays = p.listed_at ? Math.max(0, (asOf - Date.parse(p.listed_at + 'T00:00:00Z')) / 864e5) : null;
    const other = s.protocols[(i + (n >> 1)) % n]; // negative control: unrelated row's growth
    return { size: L10(p.tvl_usd) - 8, mom: clip(p.change_7d ?? 0, -50, 100) / 100, age: ageDays === null ? ageFill : ageDays / 365,
      ageDays, ch: Math.log2(1 + p.chains.length), ctrl: clip(other.change_7d ?? 0, -50, 100) / 100, cat: p.category ?? 'None', fam: catFamily(p.category) };
  });
}

const columns = (f, terms, lv) => {
  const r = [];
  for (const t of terms) {
    if (t === 'cat') for (const l of lv.cat) r.push(f.cat === l ? 1 : 0);
    else if (t === 'fam') for (const l of lv.fam) r.push(f.fam === l ? 1 : 0);
    else r.push(f[t]);
  }
  return r;
};
const penalties = (terms, lv) => {
  const r = [];
  for (const t of terms) {
    if (t === 'cat') for (const _ of lv.cat) r.push(L_CAT);
    else if (t === 'fam') for (const _ of lv.fam) r.push(L_FAM);
    else r.push(1e-6);
  }
  return r;
};

/** Solves A x = b by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; if (k) for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let v = M[r][n]; for (let j = r + 1; j < n; j++) v -= M[r][j] * x[j]; x[r] = v / M[r][r]; }
  return x;
}

/** Centred ridge least squares: y = c0 + sum b_j x_j. */
function fitRidge(X, y, pen) {
  const n = X.length, k = pen.length, mx = new Array(k).fill(0), my = y.reduce((a, v) => a + v, 0) / n;
  for (const r of X) for (let j = 0; j < k; j++) mx[j] += r[j] / n;
  const A = pen.map((p, i) => pen.map((_, j) => (i === j ? p : 0))), v = new Array(k).fill(0);
  for (let i = 0; i < n; i++) { const r = X[i]; for (let a = 0; a < k; a++) { const da = r[a] - mx[a]; v[a] += da * (y[i] - my); for (let b = 0; b < k; b++) A[a][b] += da * (r[b] - mx[b]); } }
  const b = k ? solve(A, v) : [];
  let c0 = my; for (let j = 0; j < k; j++) c0 -= b[j] * mx[j];
  return { c0, b };
}

/** Ridge logistic regression via damped Newton steps (unpenalised intercept). */
function fitLogit(X, y, pen) {
  const n = X.length, k = pen.length, rate = clip(y.reduce((a, v) => a + v, 0) / n, 0.01, 0.99);
  let c0 = Math.log(rate / (1 - rate)), b = new Array(k).fill(0);
  for (let it = 0; it < 25; it++) {
    const H = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)), g = new Array(k + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const r = X[i], p = sigmoid(linear({ c0, b }, r)), w = p * (1 - p), e = y[i] - p;
      g[0] += e; H[0][0] += w;
      for (let a = 0; a < k; a++) { g[a + 1] += e * r[a]; H[0][a + 1] += w * r[a]; for (let c = a; c < k; c++) H[a + 1][c + 1] += w * r[a] * r[c]; }
    }
    for (let a = 0; a <= k; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
    for (let a = 0; a < k; a++) { H[a + 1][a + 1] += pen[a]; g[a + 1] -= pen[a] * b[a]; }
    const d = solve(H, g); c0 += d[0]; b = b.map((v, j) => v + d[j + 1]);
    if (Math.max(...d.map(Math.abs)) < 1e-9) break;
  }
  return { c0, b };
}
function linear(m, x) { let v = m.c0; for (let j = 0; j < x.length; j++) v += m.b[j] * x[j]; return v; }
function sigmoid(v) { return 1 / (1 + Math.exp(-v)); }

/** Part A held-out tests: leave-one-out, and walk-forward (older tokens price newer ones). */
function testValuation(D, terms, lv) {
  const X = D.map((d) => columns(d.f, terms, lv)), y = D.map((d) => d.y), pen = penalties(terms, lv), n = D.length;
  const predict = (train, x) => terms.length ? linear(fitRidge(train.map((i) => X[i]), train.map((i) => y[i]), pen), x) : median(train.map((i) => y[i]));
  const idx = D.map((_, i) => i), loo = idx.map((i) => y[i] - predict(idx.filter((j) => j !== i), X[i]));
  const order = idx.slice().sort((a, b) => byListing(D[a].p, D[b].p)), wf = [];
  let in50 = 0, in80 = 0;
  for (let k = Math.ceil(n / 2); k < n; k++) {
    const train = order.slice(0, k), i = order[k], fit = terms.length ? fitRidge(train.map((t) => X[t]), train.map((t) => y[t]), pen) : null;
    const mid = median(train.map((t) => y[t])), at = (x) => (fit ? linear(fit, x) : mid), r = y[i] - at(X[i]), res = train.map((t) => y[t] - at(X[t]));
    wf.push(r); in50 += r >= quant(res, 0.25) && r <= quant(res, 0.75); in80 += r >= quant(res, 0.1) && r <= quant(res, 0.9);
  }
  const miss = (a) => 10 ** median(a.map(Math.abs)), x3 = (a) => a.filter((r) => Math.abs(r) < L10(3)).length / a.length;
  return { loo: miss(loo), wf: miss(wf), looRes: loo, wfCover50: in50 / wf.length, wfCover80: in80 / wf.length, looX3: x3(loo), wfX3: x3(wf), wfN: wf.length };
}

/** Part B held-out tests: ten-fold Brier & accuracy, plus walk-forward over 5 chronological blocks. */
function testOdds(D, terms, lv) {
  const X = D.map((d) => columns(d.f, terms, lv)), y = D.map((d) => d.y), pen = penalties(terms, lv), n = D.length;
  const run = (train, test) => {
    const m = terms.length ? fitLogit(train.map((i) => X[i]), train.map((i) => y[i]), pen) : null, rate = train.reduce((a, i) => a + y[i], 0) / train.length;
    return test.map((i) => [y[i], m ? sigmoid(linear(m, X[i])) : rate]);
  };
  const score = (pairs) => ({ brier: pairs.reduce((a, [t, p]) => a + (t - p) ** 2, 0) / pairs.length, acc: pairs.filter(([t, p]) => (p >= 0.5) === (t === 1)).length / pairs.length });
  const idx = D.map((_, i) => i), cv = [];
  for (let f = 0; f < 10; f++) cv.push(...run(idx.filter((i) => i % 10 !== f), idx.filter((i) => i % 10 === f)));
  const order = idx.slice().sort((a, b) => byListing(D[a].p, D[b].p)), start = Math.ceil(n / 2), wf = [];
  for (let k = 0; k < 5; k++) { const lo = start + Math.floor((k * (n - start)) / 5), hi = start + Math.floor(((k + 1) * (n - start)) / 5); wf.push(...run(order.slice(0, lo), order.slice(lo, hi))); }
  const a = score(cv), b = score(wf);
  return { loo: a.brier, wf: b.brier, cvAcc: a.acc, wfAcc: b.acc };
}

/** Fixed-order stepwise selection: a term stays only if it improves BOTH held-out tests. */
function stepwise(test, D, candidates, lv) {
  let kept = [], cur = test(D, [], lv);
  const steps = [{ term: 'base', loo: cur.loo, wf: cur.wf, status: 'baseline', extra: cur }];
  for (const t of candidates) {
    const c = test(D, [...kept, t], lv), better = c.loo < cur.loo && c.wf < cur.wf;
    steps.push({ term: t, loo: c.loo, wf: c.wf, status: better ? 'kept' : 'tested, not kept', extra: c });
    if (better) { kept.push(t); cur = c; }
  }
  const c = test(D, [...kept, 'ctrl'], lv);
  steps.push({ term: 'ctrl', loo: c.loo, wf: c.wf, status: c.loo < cur.loo && c.wf < cur.wf ? 'chance win, unused' : 'must not help', extra: c });
  return { kept, steps, best: cur };
}

/** Part A: valuation if a token launches, fitted ONLY on clean standalone traded tokens (no CEX/Bridge/LST/wrapped). */
function fitValuationModel(s, F, cls) {
  const famTvl = {};
  s.protocols.forEach((p) => { if (recorded(p) && p.category !== 'CEX') { const k = (p.symbol ?? p.gecko_id ?? '').toUpperCase(); famTvl[k] = (famTvl[k] ?? 0) + p.tvl_usd; } });
  const D = [];
  s.protocols.forEach((p, i) => { if (cls[i] === 'trade') { const tvl = famTvl[(p.symbol ?? p.gecko_id ?? '').toUpperCase()] ?? p.tvl_usd; D.push({ i, p, tvl, f: { ...F[i], size: L10(tvl) - 8 }, y: L10(p.mcap_usd / tvl) }); } });
  const lv = { cat: [...new Set(D.map((d) => d.f.cat))].sort(), fam: [...new Set(D.map((d) => d.f.fam))].sort() };
  const sw = stepwise(testValuation, D, ['size', 'fam', 'cat', 'mom', 'age', 'ch'], lv);
  const model = sw.kept.length ? fitRidge(D.map((d) => columns(d.f, sw.kept, lv)), D.map((d) => d.y), penalties(sw.kept, lv)) : { c0: median(D.map((d) => d.y)), b: [] };
  const r = sw.best.looRes, q = { p10: quant(r, 0.1), p25: quant(r, 0.25), p75: quant(r, 0.75), p90: quant(r, 0.9) };
  const comps = D.map((d, j) => ({ i: d.i, tvl: d.tvl, fit: linear(model, columns(d.f, sw.kept, lv)), held: d.y - r[j], y: d.y }));
  const cover = (lo, hi) => r.filter((v) => v >= lo && v <= hi).length / r.length;
  return { terms: sw.kept, lv, model, steps: sw.steps, best: sw.best, q, comps, n: D.length, D,
    calib: { loo50: cover(q.p25, q.p75), loo80: cover(q.p10, q.p90), wf50: sw.best.wfCover50, wf80: sw.best.wfCover80, looX3: sw.best.looX3, wfX3: sw.best.wfX3 } };
}

/** Part B: peer token-recording curve across all 442 standalone protocols, yielding conditional future launch odds. */
function fitTokenOddsModel(s, F) {
  const D = [];
  s.protocols.forEach((p, i) => { if (!ruleOut(p)) D.push({ i, p, f: F[i], y: recorded(p) ? 1 : 0 }); });
  const lv = { cat: [...new Set(D.map((d) => d.f.cat))].sort(), fam: [...new Set(D.map((d) => d.f.fam))].sort() };
  const sw = stepwise(testOdds, D, ['age', 'fam', 'size', 'mom', 'ch'], lv);
  const model = fitLogit(D.map((d) => columns(d.f, sw.kept, lv)), D.map((d) => d.y), penalties(sw.kept, lv));
  const maxAge = quant(D.map((d) => d.f.age), 0.95);
  return { terms: sw.kept, lv, model, steps: sw.steps, best: sw.best, n: D.length, pos: D.filter((d) => d.y).length, maxAge, D };
}

/** Off-list parent/kin discount fitted from multi-protocol name families in the snapshot. */
function familyFactor(s) {
  const fam = {};
  s.protocols.forEach((p) => (fam[first(p.name)] ??= []).push(p));
  let kin = 0, fresh = 0, multi = 0, withTok = 0;
  for (const g of Object.values(fam)) {
    if (g.length < 2) continue;
    multi++; const t = g.filter(recorded); if (t.length) withTok++;
    if (t.length > 1) for (const p of t) { kin++; if (!t.some((o) => o !== p && (o.symbol ?? o.gecko_id) === (p.symbol ?? p.gecko_id))) fresh++; }
  }
  const fr = kin ? fresh / kin : 1, q = multi ? withTok / multi : 0;
  return { kin, fresh, multi, withTok, kinFactor: fr, parentFactor: 1 - q + q * fr, words: new Set(s.protocols.filter(recorded).map((p) => first(p.name))) };
}

// Per-transaction gas (USD) by chain; cheapest chain on the protocol's record is selected.
const GAS = { Ethereum: 2.5, Bitcoin: 3, Tron: 1, Cardano: 0.25, Avalanche: 0.08, Binance: 0.06, Arbitrum: 0.04, Base: 0.03, Optimism: 0.03, 'OP Mainnet': 0.03, Linea: 0.05, Scroll: 0.05, 'zkSync Era': 0.05, Starknet: 0.05, Mantle: 0.03, Polygon: 0.02, Sonic: 0.02, Sui: 0.02, Berachain: 0.02, Unichain: 0.02, Monad: 0.02, Plasma: 0.05, Solana: 0.01, Aptos: 0.01, Near: 0.01, TON: 0.03, 'Hyperliquid L1': 0.01, Stellar: 0.001, Algorand: 0.001, Flare: 0.02 };
const ONRAMP = ['Ethereum', 'Solana', 'Arbitrum', 'Base', 'Optimism', 'OP Mainnet', 'Polygon', 'Binance', 'Avalanche', 'Tron', 'Sui', 'Aptos', 'TON', 'Near', 'Stellar', 'Algorand', 'Plasma', 'Flare'];
const ACTION = [
  [/Dex|Liquidity|Farm/, 'lp', 15, 0, 3, "Swap half of {D} into the pair and add both sides to {N}'s deepest major-asset pool on {C} (3 tx), wide range to limit impermanent loss", 'Impermanent loss and pool fee-tier drift; stick to correlated or major pairs rather than thin long-tail pools.'],
  [/Deriv|Perp|Option|Prediction/, 'perp', 0, 8, 2, 'Post {D} USDC margin on {N} on {C} and trade about 1x weekly as an offsetting long/short pair (0.04% a side)', 'Funding-rate drag and liquidation risk; keep leverage under 2x and avoid holding unhedged directional exposure overnight.'],
  [/^Chain$/, 'chain', 10, 0, 3, 'Bridge {D} into {N} via its canonical bridge and split it across its largest lending market and primary DEX', 'Canonical bridge delay and single-sequencer downtime; verify withdrawal exit latency before sizing up.'],
  [/CDP|Stablecoin|Algo/, 'cdp', 0, 0, 3, 'Post {D} of collateral in {N} on {C} and mint or borrow its stable asset under 40% LTV for safe headroom', 'Liquidation and stablecoin depeg risk; maintain at least a 250% collateral ratio and monitor redemption queues.'],
  [/Lend|Credit/, 'lend', 0, 0, 2, "Supply {D} USDC to {N}'s deepest market on {C} (approve + supply) with zero borrowing to eliminate liquidation risk", 'Bad-debt socialisation and utilisation spikes; avoid illiquid isolated pools whose borrow rate pins at 100%.'],
  [/.*/, 'vault', 0, 0, 2, "Deposit {D} USDC (or its primary vault asset) into {N}'s largest vault on {C} and hold the receipt token in the same wallet", 'Stacked strategy risk: a vault routes capital into underlying markets; avoid vaults whose yield is mostly an unlisted points token.'],
];
const usd = (v) => (v < 0 ? '-$' : '$') + (Math.abs(v) >= 100 ? String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : Math.abs(v).toFixed(2));
const big = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K' : usd(v);

/** Costed 8-step farm plan under scenario {dep, share, weeks}. FARM beats both a 4% T-bill and $25/hour. */
function buildFarmPlan(p, implied, odds, sc, exitDropPct) {
  const chains = p.chains.length ? p.chains : ['Ethereum'];
  const chain = chains.slice().sort((a, b) => (GAS[a] ?? 0.1) - (GAS[b] ?? 0.1) || chains.indexOf(a) - chains.indexOf(b))[0], gas = GAS[chain] ?? 0.1;
  const D = sc.dep === 'plan' ? clip(Math.round((p.tvl_usd * 0.0002) / 100) * 100, 1000, 25000) : sc.dep, W = sc.weeks;
  const [, kind, bpsIn, bpsWeek, txIn, act, riskNote] = ACTION.find((a) => a[0].test(p.category ?? '')), onramp = ONRAMP.includes(chain);
  const fill = (t) => t.replace(/{D}/g, usd(D)).replace(/{N}/g, p.name).replace(/{C}/g, chain);
  const exitAt = p.tvl_usd * (1 + exitDropPct / 100), perTouch = kind === 'perp' ? 3 : 1;
  const steps = [
    ['SETUP', `Create a fresh wallet dedicated to this farm and fund $10 of ${chain} gas ${onramp ? 'directly from an exchange' : 'via a major bridge from Ethereum'} (${usd(gas)}/tx, cheapest of ${chains.length} chain${chains.length > 1 ? 's' : ''}).`, onramp ? 1 : 4, 10],
    ['VERIFY', `Open ${p.name} from its DefiLlama listing, cross-check contract addresses against official docs, and test a $100 deposit + withdrawal before sizing up.`, 4 * gas, 10],
    ['FUND', `Move ${usd(D)} USDC to ${chain} ${onramp ? 'via direct exchange withdrawal' : 'over an audited bridge'}; keep $50 liquid for top-ups and unwind gas.`, onramp ? 1 : 3, 10],
    ['RISK', `${riskNote} Cap total allocation at ${((D / p.tvl_usd) * 100).toFixed(4)}% of ${p.name}'s ${big(p.tvl_usd)} TVL.`, 0, 10],
    ['CORE', `${fill(act)}; log the entry tx hash and receipt-token balance.`, txIn * gas + (D * bpsIn) / 1e4, 15],
    ['CADENCE', `Touch the position once a week for ${W} weeks (${perTouch > 1 ? 'offsetting perp pair' : 'claim, compound or $25 top-up'}) so the wallet builds ${W} active weeks (${W * perTouch} tx).`, W * perTouch * gas + (W * D * bpsWeek) / 1e4, 5 * W],
    ['EXIT RULE', `Check weekly: withdraw immediately if TVL drops below ${big(exitAt)} (${exitDropPct.toFixed(1)}% under today's ${big(p.tvl_usd)}, the snapshot's 95th-percentile weekly drawdown), if withdrawals pause, or after a snapshot.`, 2 * gas, Math.max(10, 2 * W)],
    ['RECORD & CLAIM', `Maintain a tx ledger for tax basis; claim only from ${p.name}'s verified app URL (never DMs) and unwind after week ${W} if no launch is announced.`, 2 * gas, 15],
  ].map(([tag, text, cost, min]) => ({ tag, text, cost, min }));
  const fees = steps.reduce((a, t) => a + t.cost, 0), hours = steps.reduce((a, t) => a + t.min, 0) / 60;
  const slice = (implied * sc.share * D) / (p.tvl_usd + D), sliceIfLaunch = slice / Math.max(odds, 0.01), net = slice - fees, perHour = net / hours;
  const tbill = (D * 0.04 * W) / 52, beShare = (fees * (p.tvl_usd + D)) / (implied * D), beOdds = (fees / Math.max(sliceIfLaunch, 1e-9));
  const verdict = net > tbill && perHour >= 25 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { chain, gas, kind, deposit: D, weeks: W, steps, fees, hours, slice, sliceIfLaunch, net, perHour, verdict, tbill, breakEvenShare: beShare, breakEvenOdds: beOdds, exitAt, exitDropPct };
}
const stepLine = (t) => `${t.tag}: ${t.text} Cost about ${usd(t.cost)}; ${t.min >= 120 ? (t.min / 60).toFixed(1) + ' h' : t.min + ' min'}.`;

/** Deterministic PRNG (Mulberry32) for reproducible bootstrap refits. */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Runs the full radar: 758-protocol ledger, valuation & survival-odds models, 198 ranked rows, 160 bootstrap refits. */
function runRadar(s, sc = { dep: 'plan', share: 0.07, weeks: 12 }, opts = {}) {
  const cls = classifyProtocols(s), ages = s.protocols.filter((p) => p.listed_at).map((p) => Math.max(0, (Date.parse(s.as_of) - Date.parse(p.listed_at)) / 864e5 / 365));
  const ch7 = s.protocols.map((p) => p.change_7d).filter((v) => v !== null);
  const exitDropPct = Math.min(-10, quant(ch7, 0.05));
  const F = features(s, median(ages)), V = fitValuationModel(s, F, cls), O = fitTokenOddsModel(s, F), fam = familyFactor(s);
  const condOdds = (om, f) => {
    const pNow = sigmoid(linear(om, columns(f, O.terms, O.lv)));
    const pMax = sigmoid(linear(om, columns({ ...f, age: Math.max(f.age, O.maxAge) }, O.terms, O.lv)));
    return { pNow, pMax, odds: clip((pMax - pNow) / Math.max(0.05, 1 - pNow), 0.08, 0.95) };
  };
  const value = (vm, om, i) => {
    const mult = 10 ** linear(vm, columns(F[i], V.terms, V.lv)), co = condOdds(om, F[i]);
    const famF = cls[i] !== 'off' ? 1 : fam.words.has(first(s.protocols[i].name)) ? fam.kinFactor : fam.parentFactor;
    return { mult, ...co, famF, implied: Math.max(1, Math.round(s.protocols[i].tvl_usd * mult * co.odds * famF)) };
  };
  const ranked = s.protocols.map((p, i) => i).filter((i) => ['watch', 'off', 'early'].includes(cls[i]));
  const rows = ranked.map((i) => ({ i, p: s.protocols[i], f: F[i], tier: cls[i], ...value(V.model, O.model, i) }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  rows.forEach((r, k) => { r.rank = k + 1; r.plan = buildFarmPlan(r.p, r.implied, r.odds, sc, exitDropPct); });
  if (opts.boot !== false) {
    const rand = rng(SEED), ranks = rows.map(() => []), coef = [];
    const XV = V.D.map((d) => columns(d.f, V.terms, V.lv)), XO = O.D.map((d) => columns(d.f, O.terms, O.lv));
    for (let b = 0; b < BOOT; b++) {
      const iv = V.D.map(() => Math.floor(rand() * V.D.length)), io = O.D.map(() => Math.floor(rand() * O.D.length));
      const vm = V.terms.length ? fitRidge(iv.map((j) => XV[j]), iv.map((j) => V.D[j].y), penalties(V.terms, V.lv)) : V.model;
      const om = fitLogit(io.map((j) => XO[j]), io.map((j) => O.D[j].y), penalties(O.terms, O.lv));
      coef.push({ v: vm.b, o: om.b, c: vm.c0 });
      const iv2 = rows.map((r, k) => [value(vm, om, r.i).implied, k]).sort((x, y) => y[0] - x[0]);
      iv2.forEach(([, k], pos) => ranks[k].push(pos + 1));
    }
    rows.forEach((r, k) => { r.rankLo = Math.round(quant(ranks[k], 0.1)); r.rankHi = Math.round(quant(ranks[k], 0.9)); });
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    V.se = V.model.b.map((_, j) => sd(coef.map((c) => c.v[j]))); V.seC0 = sd(coef.map((c) => c.c)); O.se = O.model.b.map((_, j) => sd(coef.map((c) => c.o[j])));
  }
  const ledger = {}; cls.forEach((c) => (ledger[c] = (ledger[c] ?? 0) + 1));
  return { s, cls, F, V, O, fam, rows, ledger, sc, TERMS, exitDropPct, bootN: BOOT };
}

/** board.json rows with concrete, costed, timed farm_steps. */
function boardRows(R) {
  return R.rows.map((r) => ({ rank: r.rank, slug: r.p.slug, name: r.p.name, implied_value_usd: r.implied, tier: r.tier, category: r.p.category, chains: r.p.chains,
    tvl_usd: r.p.tvl_usd, change_7d: r.p.change_7d, listed_at: r.p.listed_at, value_if_launch_usd: Math.round(r.p.tvl_usd * r.mult), token_odds: +r.odds.toFixed(4), family_factor: +r.famF.toFixed(4),
    rank_range: [r.rankLo, r.rankHi], verdict: r.plan.verdict, deposit_usd: r.plan.deposit, fees_usd: +r.plan.fees.toFixed(2), net_usd: +r.plan.net.toFixed(2), hours: +r.plan.hours.toFixed(2), farm_steps: r.plan.steps.map(stepLine) }));
}

/** FNV-1a checksum over rank:slug:value lines verified live in the browser. */
function checksum(rows) { let h = 0x811c9dc5; for (const r of rows) for (const ch of `${r.rank}:${r.slug}:${r.implied_value_usd}\n`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

const api = { runRadar, boardRows, checksum, buildFarmPlan, classifyProtocols, fitValuationModel, fitTokenOddsModel, linear, columns, sigmoid, quant, median, usd, big };
if (typeof module === 'object' && module.exports) module.exports = api; else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
