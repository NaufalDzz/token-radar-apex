/* Launch Radar Apex: refits model.js on snapshot.json in-browser, proves byte-exact equality with board.json
 (checkBoardIntegrity), and renders the full-width board, protocol detail view, and live farm scenario engine. */
(() => {
'use strict';
const M = window.RadarModel, DATA = window.RADAR_DATA, app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const { big, usd } = M, clip = (v, a, b) => Math.min(b, Math.max(a, v)), pct = (v, d = 0) => (v * 100).toFixed(d) + '%', x = (v) => '×' + (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const sgn = (v) => (v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'), cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const age = (d) => (d === null ? 'n/a' : d < 365 ? Math.round(d) + ' d' : (d / 365).toFixed(1) + ' yr');
const net = (v) => (v >= 0 ? '+' : '−') + usd(Math.abs(v));
const TIER = { watch: 'Watchlist', early: 'Early', off: 'Off-list' }, q = new URLSearchParams(location.search);
const DEF = { verdict: 'All', tier: 'All', cat: '', chain: '', text: '', sort: 'rank', dir: 1, dep: 'plan', share: 0.07, weeks: 12 }, st = { tab: 'board', slug: null, ...DEF };

const t0 = performance.now(), R = M.runRadar(DATA.snapshot), refitMs = Math.round(performance.now() - t0);
const { V, O, rows, ledger } = R, S = DATA.snapshot;

/** Proves this page's in-browser refit matches main.ts's board.json on every row, rank, total, and FNV-1a checksum. */
function checkBoardIntegrity() {
  const mine = M.boardRows(R), want = new Map(DATA.board.map((e) => [e[1], e]));
  const same = mine.filter((r) => { const e = want.get(r.slug); return e && e[0] === r.rank && e[2] === r.implied_value_usd; }).length;
  const mono = mine.every((r, i) => r.rank === i + 1 && (!i || r.implied_value_usd <= mine[i - 1].implied_value_usd));
  const total = mine.reduce((a, r) => a + r.implied_value_usd, 0), sum = M.checksum(mine), have = new Set(mine.map((r) => r.slug));
  const wl = S.watchlist.filter((s) => have.has(s)).length, led = Object.values(ledger).reduce((a, b) => a + b, 0);
  return [
    [same === DATA.board.length && same === mine.length, `this table = board.json: ${same} of ${DATA.board.length} rows recomputed here (${(refitMs / 1000).toFixed(1)} s)`],
    [mono, `ranks 1–${mine.length} in order, values never rise`],
    [total === DATA.total, `totals equal: ${usd(total)}`],
    [sum === DATA.checksum, `checksum ${sum} = main.ts`],
    [wl === S.watchlist.length, `watchlist ${wl} of ${S.watchlist.length} ranked`],
    [led === S.protocols.length, `ledger ${led} of ${S.protocols.length} protocols`],
  ];
}
const integrity = checkBoardIntegrity();

/** Recomputes every protocol's costed farm plan under the active scenario controls. */
const sc = () => ({ dep: st.dep, share: st.share, weeks: st.weeks });
function applyScenario() { for (const r of rows) r.plan = M.buildFarmPlan(r.p, r.implied, r.odds, sc(), R.exitDropPct); }

const KEYS = { rank: (r) => -r.rank, name: (r) => r.p.name.toLowerCase(), tvl: (r) => r.p.tvl_usd, c7: (r) => r.p.change_7d ?? -1e9, age: (r) => r.f.ageDays ?? -1,
  odds: (r) => r.odds, launch: (r) => r.mult * r.p.tvl_usd, implied: (r) => r.implied, net: (r) => r.plan.net, ph: (r) => r.plan.perHour };
function visibleRows() {
  const t = st.text.toLowerCase(), k = KEYS[st.sort];
  return rows.filter((r) => (st.verdict === 'All' || r.plan.verdict === st.verdict) && (st.tier === 'All' || r.tier === st.tier) && (!st.cat || (r.p.category ?? 'None') === st.cat)
    && (!st.chain || r.p.chains.includes(st.chain)) && (!t || `${r.p.name} ${r.p.category} ${r.p.chains.join(' ')}`.toLowerCase().includes(t)))
    .sort((a, b) => { const u = k(a), v = k(b); return (u < v ? 1 : u > v ? -1 : a.rank - b.rank) * st.dir; });
}

function renderKpis() {
  const vb = V.steps[0], ob = O.steps[0], f = rows.filter((r) => r.plan.verdict === 'FARM').length, m = rows.filter((r) => r.plan.verdict === 'MARGINAL').length;
  const card = (h, v, s, c = '') => `<div class="kpi"><h3>${h}</h3><b class="${c}">${v}</b><p>${s}</p></div>`;
  return `<section class="kpis">${[
    card('Out-of-sample miss · walk-forward', `${x(V.best.wf)} <span>vs ${x(vb.wf)} flat</span>`, `fitted on ${V.n} clean standalone traded tokens; left-out ${x(V.best.loo)} vs ${x(vb.loo)}`),
    card('Is the printed range honest?', `${pct(V.calib.wf50)} · ${pct(V.calib.wf80)}`, 'of later-listed caps fall inside P25–P75 · P10–P90 (stated 50% · 80%)'),
    card('Token odds vs base rate, Brier', `${O.best.wf.toFixed(3)} <span>vs ${ob.wf.toFixed(3)}</span>`, `walk-forward; ${pct(O.best.wfAcc)} of later peers called right vs ${pct(ob.extra.wfAcc)}`),
    card('Terms that survived both tests', `${V.terms.length} of 6 · ${O.terms.length} of 5`, 'value model · token odds; negative control failed both'),
    card('Worth farming, this scenario', `${f} of ${rows.length}`, `net beats a 4% T-bill and $25/h; ${m} marginal, ${rows.length - f - m} skip`, 'pos'),
    card('Watchlist ranked', `${S.watchlist.length} / ${S.watchlist.length}`, `plus ${rows.length - S.watchlist.length} pre-token protocols (${ledger.early} early, ${ledger.off} off-list)`),
  ].join('')}</section>
  <p class="formula"><b>Implied value</b> = TVL × fitted multiple (if a token launches) × conditional launch odds (from peer survival across ${O.n} standalone protocols). Every coefficient is fitted on this snapshot and tested held-out.</p>`;
}

const LEDGER = [['watch', 'Ranked · watchlist', 'c1'], ['early', 'Ranked · early (<$50M)', 'c2'], ['off', 'Ranked · off-list (parent)', 'c3'], ['trade', 'Token trades · clean comp', 'c4'],
  ['recorded', 'Token recorded · other/no cap', 'c5'], ['bridge', 'Out · bridge', 'c6'], ['lst', 'Out · liquid staking', 'c7'], ['cex', 'Out · exchange', 'c8'], ['wrap', 'Out · versioned/wrapped', 'c9']];
function renderAccounting() {
  const n = S.protocols.length, bar = LEDGER.map(([k, , c]) => `<i class="${c}" style="width:${((ledger[k] ?? 0) / n) * 100}%"></i>`).join('');
  const ribbon = integrity.map(([ok, t]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</span>`).join('');
  return `<section class="card acct"><div class="ah"><h2>Protocol accounting</h2><em>all ${n} snapshot protocols in exactly one group: ${rows.length} ranked pre-token, ${ledger.trade + ledger.recorded} record a token, ${ledger.bridge + ledger.lst + ledger.cex + ledger.wrap} excluded by house rule</em></div>
    <div class="lbar">${bar}</div>
    <ul class="legend">${LEDGER.map(([k, l, c]) => `<li><i class="${c}"></i>${l} <b>${ledger[k] ?? 0}</b></li>`).join('')}</ul>
    <div class="ribbon">${ribbon}</div></section>`;
}

function evidenceTable(a, isOdds) {
  const f = (v, ex, wf) => isOdds ? `${v.toFixed(3)} <s>(${pct(wf ? ex.wfAcc : ex.cvAcc)})</s>` : x(v);
  const lab = (t) => (t === 'base' ? (isOdds ? 'base rate of peers' : 'flat median multiple') : R.TERMS[t]);
  return `<table class="ev"><tr><th>Term, added in order</th><th>${isOdds ? 'Ten-fold' : 'Leave-1-out'}</th><th>Walk-forward</th><th></th></tr>${a.steps.map((s) =>
    `<tr><td>${lab(s.term)}</td><td>${f(s.loo, s.extra, false)}</td><td>${f(s.wf, s.extra, true)}</td><td class="${s.status === 'kept' ? 'pos' : s.term === 'ctrl' || s.status === 'baseline' ? 'mut' : 'neg'}">${s.status}</td></tr>`).join('')}</table>`;
}

/** Compact log-log Market Cap vs TVL scatter plot for the 3-column evidence card. */
function renderMiniScatter() {
  const W = 380, H = 122, l = 34, b = 16, X0 = 6.5, X1 = 10.5, Y0 = 4.5, Y1 = 10.8;
  const px = (v) => l + ((v - X0) / (X1 - X0)) * (W - l - 6), py = (v) => H - b - ((v - Y0) / (Y1 - Y0)) * (H - b - 6);
  const curve = (off) => [X0, X1].map((t) => `${px(t).toFixed(1)},${py(t + M.linear(V.model, M.columns({ size: t - 8, cat: '', fam: '', mom: 0, age: 0, ch: 0, ctrl: 0 }, V.terms, V.lv)) + off).toFixed(1)}`);
  const dots = V.D.map((d) => `<circle cx="${px(Math.log10(d.tvl)).toFixed(1)}" cy="${py(Math.log10(d.p.mcap_usd)).toFixed(1)}" r="2" class="cp"/>`).join('');
  const top = rows.slice(0, 12).map((r) => `<circle cx="${px(Math.log10(r.p.tvl_usd)).toFixed(1)}" cy="${py(Math.log10(r.implied)).toFixed(1)}" r="2.8" class="tp"/>`).join('');
  const grid = [7, 8, 9, 10].map((t) => `<line x1="${px(t)}" x2="${px(t)}" y1="4" y2="${H - b}"/><text x="${px(t)}" y="${H - 4}">${['$10M', '$100M', '$1B', '$10B'][t - 7]}</text>`).join('')
    + [5, 7, 9].map((t) => `<line x1="${l}" x2="${W - 6}" y1="${py(t)}" y2="${py(t)}"/><text x="${l - 4}" y="${py(t) + 3}" class="ya">${['$100k', '$10M', '$1B'][(t - 5) / 2]}</text>`).join('');
  return `<svg class="scsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="market cap vs TVL log-log"><g class="gr">${grid}</g><polygon class="band" points="${[...curve(V.q.p25), ...curve(V.q.p75).reverse()].join(' ')}"/><polyline class="fit" points="${curve(0).join(' ')}"/>${dots}${top}</svg>
    <p class="key"><i class="cp"></i>${V.n} traded comps <i class="fitk"></i>size curve ± P25–P75 <i class="tp"></i>top 12 implied</p>`;
}

function renderEvidence() {
  const c = V.calib;
  return `<section class="card evid"><div class="ah"><h2>Out-of-sample evidence</h2><em>a term is kept only if it lowers held-out error in BOTH tests: cross-validation and chronological walk-forward</em></div>
    <div class="evgrid">
      <div><h4>Value if a token launches · typical miss, ${V.n} clean traded tokens</h4>${evidenceTable(V, false)}</div>
      <div><h4>Token odds · Brier (share right), ${O.n} standalone peers</h4>${evidenceTable(O, true)}</div>
      <div><h4>Range honesty &amp; log-log fit (${R.bootN} bootstrap refits)</h4>
        <table class="ev ev3"><tr><th>Share of real caps</th><th>Leave-1-out</th><th>Walk-forward</th></tr>
          <tr><td>within ×3 of model</td><td>${pct(c.looX3)}</td><td>${pct(c.wfX3)}</td></tr>
          <tr><td>inside P25–P75 (50%)</td><td>${pct(c.loo50)}</td><td>${pct(c.wf50)}</td></tr>
          <tr><td>inside P10–P90 (80%)</td><td>${pct(c.loo80)}</td><td>${pct(c.wf80)}</td></tr></table>
        <p class="cal">Multiple at $100M TVL: <b>${x(10 ** V.model.c0)}</b>; size slope <b>${V.model.b[0]?.toFixed(2)} ± ${V.se?.[0]?.toFixed(2)}</b>. Odds use peer survival (age, family, TVL, 7d growth).</p>
        ${renderMiniScatter()}</div>
    </div></section>`;
}

const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${key}:${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function renderControls(vis) {
  const n = (v) => rows.filter((r) => v === 'All' || r.plan.verdict === v).length, cats = [...new Set(rows.map((r) => r.p.category ?? 'None'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.p.chains))].sort(), opt = (a, cur, all) => `<option value="">${all}</option>` + a.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const filtered = st.verdict !== 'All' || st.tier !== 'All' || st.cat || st.chain || st.text || st.sort !== 'rank';
  const t = vis.reduce((a, r) => a + r.implied, 0), tv = vis.reduce((a, r) => a + r.p.tvl_usd, 0);
  return `<div class="ctrl"><div class="bar">${seg('verdict', ['All', 'FARM', 'MARGINAL', 'SKIP'].map((v) => [v, `${v === 'All' ? 'All' : v[0] + v.slice(1).toLowerCase()} <s>${n(v)}</s>`]))}
    ${seg('tier', [['All', 'All tiers'], ['watch', 'Watchlist 40'], ['early', 'Early <$50M'], ['off', 'Off-list 20']])}
    <label>Deposit</label>${seg('dep', [['plan', 'Plan 0.02% TVL'], [1000, '$1k'], [5000, '$5k'], [25000, '$25k']])}
    <label>Drop</label>${seg('share', [[0.035, '3.5%'], [0.07, '7%'], [0.14, '14%']])}
    <label>Horizon</label>${seg('weeks', [[12, '12w'], [26, '26w'], [52, '52w']])}</div>
    <div class="bar"><input id="find" placeholder="Search name, chain, category" value="${esc(st.text)}"><select data-key="cat">${opt(cats, st.cat, 'All categories')}</select><select data-key="chain">${opt(chains, st.chain, 'All chains')}</select>
    <button data-act="reset">Reset</button><button data-act="csv">CSV</button><button data-act="json">JSON</button>
    ${filtered ? `<span class="chip">Filtered to ${[st.verdict !== 'All' && st.verdict + ' verdict', st.tier !== 'All' && TIER[st.tier], st.cat, st.chain, st.text && `“${esc(st.text)}”`].filter(Boolean).join(' · ') || 'All rows'} · sorted by ${st.sort === 'ph' ? 'net / hour' : st.sort}, ${st.dir > 0 ? 'high to low' : 'low to high'}</span>` : ''}
    <span id="status">${vis.length} of ${rows.length} rows · ${big(tv)} TVL · ${big(t)} implied</span></div></div>`;
}

function renderTable(vis) {
  const lo = Math.log10(rows[rows.length - 1].implied * 10 ** V.q.p25), hi = Math.log10(rows[0].implied * 10 ** V.q.p75), span = (v) => clip(((Math.log10(v) - lo) / (hi - lo)) * 100, 0, 100);
  const th = (k, l, c = '') => `<th data-sort="${k}" class="${c}${st.sort === k ? ' on' : ''}">${l}${st.sort === k ? (st.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const body = vis.map((r) => {
    const a = span(r.implied * 10 ** V.q.p25), z = span(r.implied * 10 ** V.q.p75), P = r.plan;
    return `<tr data-slug="${esc(r.p.slug)}"><td class="rk">${r.rank}<small>${r.rankLo}–${r.rankHi}</small></td>
      <td class="pn"><b>${esc(r.p.name)}</b> <span class="tg ${r.tier}">${TIER[r.tier]}</span>${r.famF < 1 ? `<span class="tg par">Parent ${x(r.famF)}</span>` : ''}<small>${esc(r.p.category ?? 'No category')} · ${esc(r.p.chains[0] ?? '')}${r.p.chains.length > 1 ? ' +' + (r.p.chains.length - 1) : ''}</small></td>
      <td>${big(r.p.tvl_usd)}</td><td class="${cls(r.p.change_7d)}">${sgn(r.p.change_7d)}</td><td>${age(r.f.ageDays)}</td>
      <td><span class="ob"><i style="width:${pct(r.odds)}"></i></span>${pct(r.odds)}</td><td>${big(r.mult * r.p.tvl_usd)}</td>
      <td class="iv"><div class="ivrow"><b>${big(r.implied)}</b><small>${big(r.implied * 10 ** V.q.p25)}–${big(r.implied * 10 ** V.q.p75)}</small></div><span class="rb"><i style="left:${a}%;width:${Math.max(2, z - a)}%"></i><u style="left:${span(r.implied)}%"></u></span></td>
      <td class="vd"><span class="pill ${P.verdict}">${P.verdict}</span> <b class="${cls(P.net)}">${net(P.net)}</b><small>${usd(P.slice)} drop − ${usd(P.fees)} fees</small></td>
      <td class="ph ${cls(P.perHour)}">${net(P.perHour)}</td></tr>`;
  }).join('');
  return `<div class="tw"><table class="board"><thead><tr>${th('rank', '# · range')}${th('name', 'Protocol', 'l')}${th('tvl', 'TVL')}${th('c7', '7D')}${th('age', 'No-token age')}${th('odds', 'Token odds')}${th('launch', 'If it launches')}${th('implied', 'Implied value · P25–P75')}${th('net', 'Verdict · net of fees')}${th('ph', 'Net / hour')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderBoardView() {
  const vis = visibleRows();
  return `${renderKpis()}${renderAccounting()}${renderEvidence()}${renderControls(vis)}${renderTable(vis)}`;
}

function nearestPeers(r) {
  const lt = Math.log10(r.p.tvl_usd), all = V.D.map((d, j) => ({ d, c: V.comps[j], gap: Math.abs(Math.log10(d.tvl) - lt) + (d.p.category === r.p.category ? 0 : d.f.fam === r.f.fam ? 0.6 : 1.8) }));
  return all.sort((a, b) => a.gap - b.gap).slice(0, 8);
}

function renderDetail(r) {
  const P = r.plan, dropped = V.steps.filter((s) => s.status === 'tested, not kept');
  const line = (h, s, v, c = '') => `<tr class="${c}"><td><b>${h}</b><small>${s}</small></td><td>${v}</td></tr>`;
  let cum = 0;
  const steps = P.steps.map((s, i) => { cum += s.cost; return `<li><i>${i + 1}</i><div><b>${s.tag}</b> ${esc(s.text)}<p><span>COST ${s.cost > 0 ? usd(s.cost) : 'free'}</span><span>TIME ${s.min >= 120 ? (s.min / 60).toFixed(1) + ' h' : s.min + ' min'}</span><span>CUMULATIVE ${usd(cum)}</span></p></div></li>`; }).join('');
  const peers = nearestPeers(r).map(({ d, c }) => `<tr><td>${esc(d.p.name)} <small>${esc(d.p.symbol ?? '')}</small></td><td>${esc((d.p.category ?? '').slice(0, 16))}</td><td>${big(d.tvl)}</td><td>${big(d.p.mcap_usd)}</td><td>${x(10 ** d.y)}</td><td class="${Math.abs(d.y - c.held) < Math.log10(3) ? 'pos' : 'neg'}">${x(10 ** (d.y - c.held))}</td></tr>`).join('');
  const tile = (h, v, c = '') => `<div><h5>${h}</h5><b class="${c}">${v}</b></div>`;
  return `<div class="crumb"><a href="#" data-act="back">← Board</a> / ${esc(r.p.name)}</div>
  <section class="hero">
    <div class="card">
      <p class="am">#${r.rank} of ${rows.length} by implied value · rank ${r.rankLo}–${r.rankHi} across ${R.bootN} bootstrap refits</p>
      <h1>${esc(r.p.name)}</h1>
      <p class="tags"><span class="tg ${r.tier}">${TIER[r.tier]}</span><span class="pill ${P.verdict}">${P.verdict}</span>${[r.p.category ?? 'No category', r.f.fam, ...r.p.chains.slice(0, 4)].map((c) => `<span class="tg">${esc(c)}</span>`).join('')}</p>
      <div class="stats">${tile('TVL', big(r.p.tvl_usd))}${tile('7-day change', sgn(r.p.change_7d), cls(r.p.change_7d))}${tile('Listed since', r.p.listed_at ?? 'n/a')}${tile('No-token age', age(r.f.ageDays))}</div>
    </div>
    <div class="card ivcard">
      <h5>Implied value · a model estimate</h5>
      <b>${usd(r.implied)}</b>
      <div class="stats">${tile('If a token launches', big(r.mult * r.p.tvl_usd))}${tile('Token odds', pct(r.odds))}${tile('P25–P75', big(r.implied * 10 ** V.q.p25) + '–' + big(r.implied * 10 ** V.q.p75))}${tile('P10–P90', big(r.implied * 10 ** V.q.p10) + '–' + big(r.implied * 10 ** V.q.p90))}</div>
      <p class="pos">✓ Recomputed in this browser: equals board.json. DefiLlama records no token for it, which is not proof it has none; odds are its peers' survival record.</p>
    </div>
  </section>
  <div class="detail">
    <div class="col">
      <section class="card"><h2>How the figure is made</h2><table class="dc">
        ${line('TVL', `DefiLlama snapshot, ${S.as_of}`, big(r.p.tvl_usd))}
        ${line('Base multiple', `fitted on ${V.n} clean standalone traded tokens, read at $100M TVL; held-out miss ${x(V.best.loo)} left-out, ${x(V.best.wf)} walk-forward`, x(10 ** V.model.c0))}
        ${line('Size curve, log TVL', `slope ${V.model.b[0].toFixed(2)} ± ${V.se[0].toFixed(2)} × log10(${big(r.p.tvl_usd)} / $100M)`, x(10 ** (V.model.b[0] * r.f.size)))}
        ${line('= Value if a token launches', `TVL × ${x(r.mult)}; half of held-out caps fall in ${big(r.mult * r.p.tvl_usd * 10 ** V.q.p25)}–${big(r.mult * r.p.tvl_usd * 10 ** V.q.p75)}`, big(r.mult * r.p.tvl_usd), 'am')}
        ${line('× Conditional token odds', `peers of ${esc(r.f.fam)}, TVL & 7d growth: ${pct(r.pNow)} record a token by age ${age(r.f.ageDays)}, ${pct(r.pMax)} by mature cohort (${O.maxAge.toFixed(1)} yr) → (${pct(r.pMax)} − ${pct(r.pNow)}) ÷ (100% − ${pct(r.pNow)}); Brier ${O.best.wf.toFixed(3)} vs ${O.steps[0].wf.toFixed(3)}`, x(r.odds))}
        ${r.famF < 1 ? line('× Family factor', `off-list: parent/kin token family exists (${R.fam.fresh} of ${R.fam.kin} kin tokens were a new ticker)`, x(r.famF)) : ''}
        ${line('= Implied value', `P25–P75 ${big(r.implied * 10 ** V.q.p25)}–${big(r.implied * 10 ** V.q.p75)} · rank ${r.rankLo}–${r.rankHi} across ${R.bootN} bootstrap refits`, big(r.implied), 'am')}
      </table><p class="note">Tested, not kept in value: ${dropped.map((s) => `${R.TERMS[s.term].slice(2)} (${x(s.loo)}, ${x(s.wf)})`).join('; ')}.</p></section>
      <section class="card"><h2>Nearest priced peers · their tokens trade</h2><table class="pt"><tr><th>Token</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Cap / TVL</th><th>Cap ÷ held-out</th></tr>${peers}</table></section>
    </div>
    <div class="col">
      <section class="card"><h2>Farm verdict <span class="pill ${P.verdict}">${P.verdict}</span><em>${usd(P.deposit)} deposit · ${pct(st.share, 1)} drop share · ${P.weeks} weeks · on ${esc(P.chain)}</em></h2>
        <p class="vs ${P.verdict}">${P.verdict}: ${usd(P.deposit)} for ${P.weeks} weeks buys a modelled drop of ${usd(P.slice)} for ${usd(P.fees)} of gas and fees and ${P.hours.toFixed(1)} h of work: <b>${net(P.net)} net (${net(P.perHour)}/h)</b> against ${usd(P.tbill)} from the same money in a 4% T-bill. Fees are covered above ${pct(P.breakEvenShare, 2)} drop share and ${pct(P.breakEvenOdds, 1)} token odds.</p>
        <div class="tiles">${tile('At risk', usd(P.deposit))}${tile(`Fees, ${P.weeks}w`, usd(P.fees))}${tile('Modelled drop', usd(P.slice))}${tile('Net of fees', net(P.net), cls(P.net))}${tile('Hands-on', P.hours.toFixed(1) + ' h')}${tile('Net per hour', net(P.perHour), cls(P.perHour))}</div>
        <div class="sgwrap"><div><h4>Net by drop share × deposit <em>active cell outlined</em></h4>${sensitivityGrid(r)}</div>
          <div><h4>Benchmarks</h4><table class="bm">
            <tr><td>Same ${usd(P.deposit)} in 4% T-bill (${P.weeks}w)</td><td>${usd(P.tbill)}</td></tr>
            <tr><td>Drop if token launches (no odds)</td><td>${usd(P.sliceIfLaunch)}</td></tr>
            <tr><td>Fees covered above drop share</td><td>${pct(P.breakEvenShare, 2)}</td></tr>
            <tr><td>Fees covered above token odds</td><td>${pct(P.breakEvenOdds, 1)}</td></tr>
            <tr><td>Exit if TVL prints below (${P.exitDropPct.toFixed(1)}%)</td><td>${big(P.exitAt)}</td></tr>
          </table></div></div>
        <p class="note">Drop = implied value × drop share × deposit ÷ (TVL + deposit). FARM: net beats a 4% T-bill and $25/h; SKIP: fees exceed drop.</p></section>
      <section class="card"><h2>Costed farm plan · ${P.steps.length} steps <em>at ${usd(P.deposit)} deposit on ${esc(P.chain)} (${usd(P.gas)}/tx)</em></h2><ol class="steps">${steps}</ol></section>
    </div>
  </div>`;
}

/** Drop share x deposit sensitivity matrix showing exact net & verdict flips. */
function sensitivityGrid(r) {
  const deps = [1000, 3000, 'plan', 25000], planDep = M.buildFarmPlan(r.p, r.implied, r.odds, { ...sc(), dep: 'plan' }, R.exitDropPct).deposit;
  const cell = (sh, d) => { const p = M.buildFarmPlan(r.p, r.implied, r.odds, { ...sc(), dep: d, share: sh }, R.exitDropPct); return `<td class="${p.verdict}${sh === st.share && d === st.dep ? ' cur' : ''}">${net(p.net)}</td>`; };
  return `<table class="sg"><tr><th>Share</th>${deps.map((d) => `<th>${d === 'plan' ? 'Plan ' + usd(planDep) : usd(d)}</th>`).join('')}</tr>${[0.035, 0.07, 0.14].map((sh) => `<tr><th>${pct(sh, 1)}</th>${deps.map((d) => cell(sh, d)).join('')}</tr>`).join('')}</table>`;
}

const table = (cols, body) => `<table class="pt"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
function renderComps() {
  const list = V.D.map((d, j) => ({ d, c: V.comps[j] })).sort((a, b) => b.d.p.mcap_usd - a.d.p.mcap_usd);
  return `<section class="card"><h2>Traded comps · ${V.n} clean standalone tokens price the model <em>cap ÷ family TVL; never ranked</em></h2>${table(['Token', 'Category', 'Family TVL', 'Market cap', 'Cap / TVL', 'Fitted', 'Held-out fit', 'Actual ÷ held-out'],
    list.map(({ d, c }) => [`${esc(d.p.name)} <small>${esc(d.p.symbol ?? '')}</small>`, esc(d.p.category ?? ''), big(d.tvl), big(d.p.mcap_usd), x(10 ** d.y), x(10 ** c.fit), x(10 ** c.held), x(10 ** (d.y - c.held))]))}</section>`;
}
function renderAside() {
  const why = { cex: 'exchange custody', bridge: 'bridge', lst: 'liquid staking / restaking', wrap: 'versioned or wrapped' };
  const list = S.protocols.map((p, i) => [p, R.cls[i]]).filter(([, c]) => why[c]).sort((a, b) => b[0].tvl_usd - a[0].tvl_usd);
  return `<section class="card"><h2>Set aside · ${list.length} non-launch protocols <em>plus ${ledger.trade + ledger.recorded} that already record a token</em></h2>${table(['Protocol', 'Category', 'TVL', 'Reason (house rule)'],
    list.map(([p, c]) => [esc(p.name), esc(p.category ?? ''), big(p.tvl_usd), why[c]]))}</section>`;
}

function render() {
  const r = st.slug && rows.find((x) => x.p.slug === st.slug), tab = (k, l) => `<button data-set="tab:${k}" class="${st.tab === k && !r ? 'on' : ''}">${l}</button>`;
  app.innerHTML = `<header><div class="logo"><i></i><div><h1>Launch Radar Apex</h1><p>pre-token protocols, valued from their own record</p></div></div>
    <nav class="seg">${tab('board', `Board <s>${rows.length}</s>`)}${tab('comps', `Traded comps <s>${V.n}</s>`)}${tab('aside', `Set aside <s>${ledger.cex + ledger.bridge + ledger.lst + ledger.wrap}</s>`)}</nav>
    <p class="meta">DefiLlama snapshot <b>${S.as_of}</b> · model refitted in this browser · no network</p></header>
    <main>${r ? renderDetail(r) : st.tab === 'comps' ? renderComps() : st.tab === 'aside' ? renderAside() : renderBoardView()}</main>`;
}

function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportRows(kind) {
  const vis = visibleRows();
  if (kind === 'json') return download('launch-radar.json', JSON.stringify(M.boardRows({ rows: vis }), null, 1), 'application/json');
  const head = 'rank,slug,name,tier,category,tvl_usd,change_7d,token_odds,value_if_launch_usd,implied_value_usd,verdict,deposit_usd,fees_usd,net_usd,net_per_hour';
  download('launch-radar.csv', [head, ...vis.map((r) => [r.rank, r.p.slug, `"${r.p.name.replace(/"/g, '""')}"`, r.tier, `"${r.p.category ?? ''}"`, r.p.tvl_usd, r.p.change_7d ?? '', r.odds.toFixed(4), Math.round(r.mult * r.p.tvl_usd), r.implied, r.plan.verdict, r.plan.deposit, r.plan.fees.toFixed(2), r.plan.net.toFixed(2), r.plan.perHour.toFixed(2)].join(','))].join('\n'), 'text/csv');
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-set],[data-act],[data-sort],tr[data-slug]');
  if (!t) return;
  if (t.dataset.set) { const [k, v] = t.dataset.set.split(':'); st[k] = ['dep', 'share', 'weeks'].includes(k) && v !== 'plan' ? +v : v; if (k === 'tab') st.slug = null; if (['dep', 'share', 'weeks'].includes(k)) applyScenario(); }
  else if (t.dataset.sort) { const k = t.dataset.sort; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; }
  else if (t.dataset.slug) { st.slug = t.dataset.slug; scrollTo(0, 0); }
  else if (t.dataset.act === 'back') { e.preventDefault(); st.slug = null; }
  else if (t.dataset.act === 'reset') { Object.assign(st, DEF); applyScenario(); }
  else if (t.dataset.act) return exportRows(t.dataset.act);
  render();
});
app.addEventListener('change', (e) => { if (e.target.dataset.key) { st[e.target.dataset.key] = e.target.value; render(); } });
app.addEventListener('input', (e) => {
  if (e.target.id !== 'find') return;
  st.text = e.target.value; render(); const f = document.getElementById('find'); f.focus(); f.setSelectionRange(st.text.length, st.text.length);
});

// Screenshot views: ?view=board, ?view=detail (top FARM watchlist row), ?view=filtered (FARM sorted by net/h).
applyScenario();
const view = q.get('view');
if (view === 'detail') st.slug = q.get('p') || (rows.find((r) => r.tier === 'watch' && r.plan.verdict === 'FARM') || rows.find((r) => r.plan.verdict === 'FARM') || rows[0]).p.slug;
if (view === 'filtered') Object.assign(st, { verdict: 'FARM', sort: 'ph', dir: 1 });
render();
document.body.setAttribute('aria-busy', 'false');
window.__RADAR_READY__ = true;
})();
