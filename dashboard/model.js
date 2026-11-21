/* Launch Radar Apex: the whole model, one file run twice. main.ts runs it in Node to write board.json; this page
 runs it again on the raw snapshot and checks every row against board.json. No protocol name appears anywhere:
 every figure is fitted from snapshot.json (TVL, 7-day growth, age, category, chains, the traded tokens' caps).
 implied value = TVL x fitted multiple (if a token launches) x token odds (peers' record) x family factor */
(function (root) {
'use strict';
const L10 = Math.log10, clip = (v, a, b) => Math.min(b, Math.max(a, v));
// The house rule's exclusions, as the snapshot README states them.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/, WRAPWORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const BRIDGE = ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'], LST = ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'];
const TERMS = { size: '+ size curve, log TVL', cat: '+ category effect (ridge 8)', mom: '+ 7-day TVL growth', age: '+ age, years tracked', ch: '+ chain breadth, log chains', ctrl: "+ control: another row's 7d growth" };
const LAMBDA = 8, BOOT = 120, SEED = 20261114;
const recorded = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
/** Which house-rule exclusion a protocol falls under, or null. */
const ruleOut = (p) => p.category === 'CEX' || EXCHANGE.test(p.name) ? 'cex' : BRIDGE.includes(p.category) ? 'bridge' : LST.includes(p.category) ? 'lst'
  : VERSIONED.test(p.name) || WRAPWORD.test(p.name) || p.category === 'Stablecoin Wrapper' ? 'wrap' : null;
const first = (n) => n.toLowerCase().split(/[\s\-.]+/)[0];
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y), i = q * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const byListing = (a, b) => (a.listed_at ?? '') < (b.listed_at ?? '') ? -1 : (a.listed_at ?? '') > (b.listed_at ?? '') ? 1 : a.slug < b.slug ? -1 : 1;

/** Every protocol in exactly one bucket: the ledger the page draws (758 of 758). */
function classifyProtocols(s) {
  const wl = new Set(s.watchlist), kinWords = new Set(s.protocols.filter(recorded).map((p) => first(p.name)));
  return s.protocols.map((p) => {
    if (p.mcap_usd > 0) return 'trade';
    if (recorded(p)) return 'recorded';
    if (wl.has(p.slug)) return 'watch';
    if (ruleOut(p)) return ruleOut(p);
    // Off-list: passes every rule yet the house left it out (above the floor: DefiLlama records a parent),
    // or it shares its first word with a protocol that records a token.
    if (p.tvl_usd >= s.floor_usd || kinWords.has(first(p.name))) return 'off';
    return 'early';
  });
}

/** One protocol's model inputs, all read off its own record. */
function features(s, ageFill) {
  const asOf = Date.parse(s.as_of + 'T00:00:00Z'), n = s.protocols.length;
  return s.protocols.map((p, i) => {
    const age = p.listed_at ? Math.max(0, (asOf - Date.parse(p.listed_at + 'T00:00:00Z')) / 864e5) : null;
    const other = s.protocols[(i + (n >> 1)) % n]; // negative control: an unrelated row's growth
    return { size: L10(p.tvl_usd) - 8, mom: clip(p.change_7d ?? 0, -50, 100) / 100, age: age === null ? ageFill : clip(age / 365, 0, 5),
      ageDays: age, ch: Math.log2(1 + p.chains.length), ctrl: clip(other.change_7d ?? 0, -50, 100) / 100, cat: p.category ?? 'None' };
  });
}

const columns = (f, terms, levels) => { const r = []; for (const t of terms) { if (t === 'cat') for (const l of levels) r.push(f.cat === l ? 1 : 0); else r.push(f[t]); } return r; };
const penalties = (terms, levels) => { const r = []; for (const t of terms) { if (t === 'cat') for (const _ of levels) r.push(LAMBDA); else r.push(1e-6); } return r; };

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

/** Ridge least squares on centred columns, returned flat: y = c0 + sum b_j x_j. */
function fitRidge(X, y, pen) {
  const n = X.length, k = pen.length, mx = new Array(k).fill(0), my = y.reduce((a, v) => a + v, 0) / n;
  for (const r of X) for (let j = 0; j < k; j++) mx[j] += r[j] / n;
  const A = pen.map((p, i) => pen.map((_, j) => (i === j ? p : 0))), v = new Array(k).fill(0);
  for (let i = 0; i < n; i++) { const r = X[i]; for (let a = 0; a < k; a++) { const da = r[a] - mx[a]; v[a] += da * (y[i] - my); for (let b = 0; b < k; b++) A[a][b] += da * (r[b] - mx[b]); } }
  const b = k ? solve(A, v) : [];
  let c0 = my; for (let j = 0; j < k; j++) c0 -= b[j] * mx[j];
  return { c0, b };
}

/** Ridge logistic regression by Newton steps (intercept unpenalised). */
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

/** Part A held-out tests: leave-one-out, and walk-forward (each newer token priced by older ones). */
function testValuation(D, terms, levels) {
  const X = D.map((d) => columns(d.f, terms, levels)), y = D.map((d) => d.y), pen = penalties(terms, levels), n = D.length;
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

/** Part B held-out tests: ten-fold Brier and accuracy, and walk-forward (five blocks of the newest half). */
function testOdds(D, terms, levels) {
  const X = D.map((d) => columns(d.f, terms, levels)), y = D.map((d) => d.y), pen = penalties(terms, levels), n = D.length;
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

/** Adds candidate terms in a fixed order; a term stays only if it beats the current model on BOTH held-out tests. */
function stepwise(test, D, candidates, levels, lowerIsBetter = true) {
  let kept = [], cur = test(D, [], levels);
  const steps = [{ term: 'base', loo: cur.loo, wf: cur.wf, status: 'baseline', extra: cur }];
  for (const t of candidates) {
    const c = test(D, [...kept, t], levels), better = c.loo < cur.loo && c.wf < cur.wf;
    steps.push({ term: t, loo: c.loo, wf: c.wf, status: better ? 'kept' : 'not kept', extra: c });
    if (better) { kept.push(t); cur = c; }
  }
  const c = test(D, [...kept, 'ctrl'], levels);
  steps.push({ term: 'ctrl', loo: c.loo, wf: c.wf, status: c.loo < cur.loo && c.wf < cur.wf ? 'chance win, unused' : 'no help, as it must', extra: c });
  return { kept, steps, best: cur };
}

/** Part A: what a token would be worth if it launched, fitted on every traded token (cap / family TVL). */
function fitValuationModel(s, F, cls) {
  const famTvl = {};
  s.protocols.forEach((p, i) => { if (recorded(p) && p.category !== 'CEX') { const k = (p.symbol ?? p.gecko_id ?? '').toUpperCase(); famTvl[k] = (famTvl[k] ?? 0) + p.tvl_usd; } });
  const D = [];
  s.protocols.forEach((p, i) => { if (cls[i] === 'trade') { const tvl = famTvl[(p.symbol ?? p.gecko_id ?? '').toUpperCase()] ?? p.tvl_usd; D.push({ i, p, tvl, f: { ...F[i], size: L10(tvl) - 8 }, y: L10(p.mcap_usd / tvl) }); } });
  const levels = [...new Set(D.map((d) => d.f.cat))].sort();
  const sw = stepwise(testValuation, D, ['size', 'cat', 'mom', 'age', 'ch'], levels);
  const model = sw.kept.length ? fitRidge(D.map((d) => columns(d.f, sw.kept, levels)), D.map((d) => d.y), penalties(sw.kept, levels)) : { c0: median(D.map((d) => d.y)), b: [] };
  const r = sw.best.looRes, q = { p10: quant(r, 0.1), p25: quant(r, 0.25), p75: quant(r, 0.75), p90: quant(r, 0.9) };
  const comps = D.map((d, j) => ({ i: d.i, tvl: d.tvl, fit: linear(model, columns(d.f, sw.kept, levels)), held: d.y - r[j], y: d.y }));
  const cover = (lo, hi) => r.filter((v) => v >= lo && v <= hi).length / r.length;
  return { terms: sw.kept, levels, model, steps: sw.steps, best: sw.best, q, comps, n: D.length, D,
    calib: { loo50: cover(q.p25, q.p75), loo80: cover(q.p10, q.p90), wf50: sw.best.wfCover50, wf80: sw.best.wfCover80, looX3: sw.best.looX3, wfX3: sw.best.wfX3 } };
}

/** Part B: token odds, the peers' record (not a forecast): how many standalone protocols like it record a token. */
function fitTokenOddsModel(s, F, cls) {
  const D = [];
  s.protocols.forEach((p, i) => { if (!ruleOut(p)) D.push({ i, p, f: F[i], y: recorded(p) ? 1 : 0 }); });
  const levels = [...new Set(D.map((d) => d.f.cat))].sort();
  const sw = stepwise(testOdds, D, ['age', 'size', 'mom', 'cat', 'ch'], levels);
  const model = fitLogit(D.map((d) => columns(d.f, sw.kept, levels)), D.map((d) => d.y), penalties(sw.kept, levels));
  return { terms: sw.kept, levels, model, steps: sw.steps, best: sw.best, n: D.length, pos: D.filter((d) => d.y).length, D };
}

/** Family factor, from the families' own record. A name family (shared first word) that already carries a token
    gives a sub-product a NEW ticker only `fresh` of the time; an off-list row with no visible kin (DefiLlama records a
    parent) has a token family with probability q, the share of multi-protocol families that carry one. */
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

// Gas per simple contract call by chain (USD); the cheapest chain wins.
const GAS = { Ethereum: 2.5, Bitcoin: 3, Tron: 1, Cardano: 0.25, Avalanche: 0.08, Binance: 0.06, Arbitrum: 0.04, Base: 0.03, Optimism: 0.03, 'OP Mainnet': 0.03, Linea: 0.05, Scroll: 0.05, 'zkSync Era': 0.05, Starknet: 0.05, Mantle: 0.03, Polygon: 0.02, Sonic: 0.02, Sui: 0.02, Berachain: 0.02, Unichain: 0.02, Monad: 0.02, Plasma: 0.01, Solana: 0.01, Aptos: 0.01, Near: 0.01, TON: 0.03, 'Hyperliquid L1': 0.01, Stellar: 0.001, Algorand: 0.001 };
const ONRAMP = ['Ethereum', 'Solana', 'Arbitrum', 'Base', 'Optimism', 'OP Mainnet', 'Polygon', 'Binance', 'Avalanche', 'Tron', 'Sui', 'Aptos', 'TON', 'Near', 'Stellar', 'Algorand', 'Plasma'];
const ACTION = [
  [/Dex|Liquidity|Farm/, 'lp', 15, 0, 3, "Swap half of {D} into the pair and add both sides to {N}'s deepest major-asset pool on {C} (3 transactions), range kept wide"],
  [/Deriv|Perp|Option|Prediction/, 'perp', 0, 8, 2, 'Post {D} USDC margin on {N} on {C} and trade about 1x it a week as an offsetting long/short pair (0.04% a side)'],
  [/^Chain$/, 'chain', 10, 0, 3, 'Bridge {D} into {N} through its canonical bridge and split it across its largest lending market and DEX'],
  [/CDP|Stablecoin|Algo/, 'cdp', 0, 0, 3, 'Post {D} of collateral in {N} on {C} and mint or borrow its stable asset under 40% loan-to-value'],
  [/Lend|Credit/, 'lend', 0, 0, 2, "Supply {D} USDC to {N}'s main market on {C} (approve + supply); borrow nothing, so no liquidation risk"],
  [/.*/, 'vault', 0, 0, 2, "Deposit {D} USDC (or the asset its main vault takes) into {N}'s largest vault on {C}; keep the receipt token there"],
];
const usd = (v) => (v < 0 ? '-$' : '$') + (Math.abs(v) >= 100 ? String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : Math.abs(v).toFixed(2));
const big = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : usd(v);

/** Costed farm plan under a scenario {dep: 'plan'|dollars, share, weeks}: six steps, each with gas and time. */
function buildFarmPlan(p, implied, sc) {
  const chains = p.chains.length ? p.chains : ['Ethereum'];
  const chain = chains.slice().sort((a, b) => (GAS[a] ?? 0.1) - (GAS[b] ?? 0.1) || chains.indexOf(a) - chains.indexOf(b))[0], gas = GAS[chain] ?? 0.1;
  const D = sc.dep === 'plan' ? clip(Math.round((p.tvl_usd * 0.0002) / 100) * 100, 1000, 25000) : sc.dep, W = sc.weeks;
  const [, kind, bpsIn, bpsWeek, txIn, act] = ACTION.find((a) => a[0].test(p.category ?? '')), onramp = ONRAMP.includes(chain);
  const fill = (t) => t.replace(/{D}/g, usd(D)).replace(/{N}/g, p.name).replace(/{C}/g, chain);
  const exitAt = p.tvl_usd * 0.75, perTouch = kind === 'perp' ? 3 : 1;
  const steps = [
    ['SETUP', `Open a wallet for this farm only; move ${usd(D)} USDC plus $25 of gas to ${chain} ${onramp ? 'straight from an exchange' : 'over a bridge from Ethereum'} (cheapest of its ${chains.length} chain${chains.length > 1 ? 's' : ''}, ${usd(gas)} a transaction).`, onramp ? 1 : 1 + 3, 15],
    ['VERIFY', `Reach ${p.name} from its DefiLlama listing, match contract addresses against its docs, then deposit and withdraw $100 to prove the exit works.`, 4 * gas, 15],
    ['CORE', fill(act) + `; ${usd(D)} is ${((D / p.tvl_usd) * 100).toFixed(4)}% of its ${big(p.tvl_usd)} TVL.`, txIn * gas + (D * bpsIn) / 1e4, 15],
    ['CADENCE', `Touch the position once a week for ${W} weeks (${perTouch > 1 ? 'the offsetting trades' : 'a claim, a compound or a $50 top-up'}) so the wallet shows steady use rather than one deposit; ${W * perTouch} transactions in all.`, W * perTouch * gas + (W * D * bpsWeek) / 1e4, 5 * W],
    ['EXIT RULE', `Withdraw at once if TVL prints below ${big(exitAt)} (25% under today's ${big(p.tvl_usd)}), if withdrawals pause, or once a snapshot is announced; otherwise unwind after week ${W}.`, 2 * gas, 10],
    ['CLAIM', `Claim only from the link on ${p.name}'s own site or docs, never from a DM; log every transaction, as a drop is taxable income in many places.`, 2 * gas, 15],
  ].map(([tag, text, cost, min]) => ({ tag, text, cost, min }));
  const fees = steps.reduce((a, t) => a + t.cost, 0), hours = steps.reduce((a, t) => a + t.min, 0) / 60;
  const slice = (implied * sc.share * D) / p.tvl_usd, net = slice - fees, perHour = net / hours;
  const verdict = net > 0 && perHour >= 15 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { chain, gas, kind, deposit: D, weeks: W, steps, fees, hours, slice, net, perHour, verdict, tbill: (D * 0.04 * W) / 52, breakEvenShare: (fees * p.tvl_usd) / (implied * D) };
}
const stepLine = (t) => `${t.tag}: ${t.text} Cost about ${usd(t.cost)}; ${t.min >= 120 ? (t.min / 60).toFixed(1) + ' h' : t.min + ' min'}.`;

/** Deterministic PRNG for the bootstrap refits. */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** The whole radar: ledger, both models, the ranked board with farm plans, bootstrap rank ranges. */
function runRadar(s, sc = { dep: 'plan', share: 0.075, weeks: 26 }, opts = {}) {
  const cls = classifyProtocols(s), ages = s.protocols.filter((p) => p.listed_at).map((p) => (Date.parse(s.as_of) - Date.parse(p.listed_at)) / 864e5 / 365);
  const F = features(s, clip(median(ages), 0, 5)), V = fitValuationModel(s, F, cls), O = fitTokenOddsModel(s, F, cls), fam = familyFactor(s);
  const value = (vm, om, i) => {
    const mult = 10 ** linear(vm, columns(F[i], V.terms, V.levels)), odds = sigmoid(linear(om, columns(F[i], O.terms, O.levels))), famF = cls[i] !== 'off' ? 1 : fam.words.has(first(s.protocols[i].name)) ? fam.kinFactor : fam.parentFactor;
    return { mult, odds, famF, implied: Math.max(1, Math.round(s.protocols[i].tvl_usd * mult * odds * famF)) };
  };
  const ranked = s.protocols.map((p, i) => i).filter((i) => ['watch', 'off', 'early'].includes(cls[i]));
  const rows = ranked.map((i) => ({ i, p: s.protocols[i], f: F[i], tier: cls[i], ...value(V.model, O.model, i) }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  rows.forEach((r, k) => { r.rank = k + 1; r.plan = buildFarmPlan(r.p, r.implied, sc); });
  if (opts.boot !== false) { // refit both models on resampled peers; each row's rank range is P10-P90 of its ranks
    const rand = rng(SEED), ranks = rows.map(() => []), coef = [];
    const XV = V.D.map((d) => columns(d.f, V.terms, V.levels)), XO = O.D.map((d) => columns(d.f, O.terms, O.levels));
    for (let b = 0; b < BOOT; b++) {
      const iv = V.D.map(() => Math.floor(rand() * V.D.length)), io = O.D.map(() => Math.floor(rand() * O.D.length));
      const vm = V.terms.length ? fitRidge(iv.map((j) => XV[j]), iv.map((j) => V.D[j].y), penalties(V.terms, V.levels)) : V.model;
      const om = fitLogit(io.map((j) => XO[j]), io.map((j) => O.D[j].y), penalties(O.terms, O.levels));
      coef.push({ v: vm.b, o: om.b, c: vm.c0 });
      const iv2 = rows.map((r, k) => [value(vm, om, r.i).implied, k]).sort((x, y) => y[0] - x[0]);
      iv2.forEach(([, k], pos) => ranks[k].push(pos + 1));
    }
    rows.forEach((r, k) => { r.rankLo = Math.round(quant(ranks[k], 0.1)); r.rankHi = Math.round(quant(ranks[k], 0.9)); });
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
    V.se = V.model.b.map((_, j) => sd(coef.map((c) => c.v[j]))); V.seC0 = sd(coef.map((c) => c.c)); O.se = O.model.b.map((_, j) => sd(coef.map((c) => c.o[j])));
  }
  const ledger = {}; cls.forEach((c) => (ledger[c] = (ledger[c] ?? 0) + 1));
  return { s, cls, F, V, O, fam, rows, ledger, sc, TERMS };
}

/** board.json's rows, with farm_steps written out in words (cost and time on every step). */
function boardRows(R) {
  return R.rows.map((r) => ({ rank: r.rank, slug: r.p.slug, name: r.p.name, implied_value_usd: r.implied, tier: r.tier, category: r.p.category, chains: r.p.chains,
    tvl_usd: r.p.tvl_usd, change_7d: r.p.change_7d, listed_at: r.p.listed_at, value_if_launch_usd: Math.round(r.p.tvl_usd * r.mult), token_odds: +r.odds.toFixed(4), family_factor: +r.famF.toFixed(4),
    rank_range: [r.rankLo, r.rankHi], verdict: r.plan.verdict, deposit_usd: r.plan.deposit, fees_usd: +r.plan.fees.toFixed(2), net_usd: +r.plan.net.toFixed(2), hours: +r.plan.hours.toFixed(2), farm_steps: r.plan.steps.map(stepLine) }));
}

/** FNV-1a over rank:slug:value lines: the checksum main.ts prints and this page recomputes. */
function checksum(rows) { let h = 0x811c9dc5; for (const r of rows) for (const ch of `${r.rank}:${r.slug}:${r.implied_value_usd}\n`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

const api = { runRadar, boardRows, checksum, buildFarmPlan, classifyProtocols, fitValuationModel, fitTokenOddsModel, linear, columns, sigmoid, quant, median, usd, big };
if (typeof module === 'object' && module.exports) module.exports = api; else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
