/* Launch Radar Apex page: refits model.js on the raw snapshot in data.js, proves the result equals board.json
 (checkBoardIntegrity), then draws the board, per-protocol detail and live farm economics. */
(() => {
'use strict';
const M = window.RadarModel, DATA = window.RADAR_DATA, app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const { big, usd } = M, pct = (v, d = 0) => (v * 100).toFixed(d) + '%', x = (v) => '×' + (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const sgn = (v) => (v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'), cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const age = (d) => (d === null ? 'n/a' : d < 365 ? Math.round(d) + ' d' : (d / 365).toFixed(1) + ' yr');
const net = (v) => (v >= 0 ? '+' : '−') + usd(Math.abs(v));
const TIER = { watch: 'Watchlist', early: 'Early', off: 'Off-list' }, q = new URLSearchParams(location.search);
const DEF = { verdict: 'All', tier: 'All', cat: '', chain: '', text: '', sort: 'rank', dir: 1, dep: 'plan', share: 0.075, weeks: 26 }, st = { tab: 'board', slug: null, ...DEF };

const t0 = performance.now(), R = M.runRadar(DATA.snapshot), refitMs = Math.round(performance.now() - t0);
const { V, O, rows, ledger } = R, S = DATA.snapshot;

/** Re-verifies this page against board.json: same rows, ranks, values, checksum, watchlist and ledger. */
function checkBoardIntegrity() {
  const mine = M.boardRows(R), want = new Map(DATA.board.map((e) => [e[1], e]));
  const same = mine.filter((r) => { const e = want.get(r.slug); return e && e[0] === r.rank && e[2] === r.implied_value_usd; }).length;
  const mono = mine.every((r, i) => r.rank === i + 1 && (!i || r.implied_value_usd <= mine[i - 1].implied_value_usd));
  const total = mine.reduce((a, r) => a + r.implied_value_usd, 0), sum = M.checksum(mine), have = new Set(mine.map((r) => r.slug));
  const wl = S.watchlist.filter((s) => have.has(s)).length, led = Object.values(ledger).reduce((a, b) => a + b, 0);
  return [
    [same === DATA.board.length && same === mine.length, `this table = board.json: ${same}/${DATA.board.length} rows refitted here (${(refitMs / 1000).toFixed(1)} s)`],
    [mono, `ranks 1–${mine.length} monotonic`],
    [total === DATA.total, `total ${big(total)} = ${big(DATA.total)}`],
    [sum === DATA.checksum, `FNV-1a ${sum} = main.ts`],
    [wl === S.watchlist.length, `watchlist ${wl}/${S.watchlist.length}`],
    [led === S.protocols.length, `ledger ${led}/${S.protocols.length}`],
  ];
}
const integrity = checkBoardIntegrity();

/** Every row's plan under the scenario controls: slice, fees, net, hours and verdict recomputed live. */
const sc = () => ({ dep: st.dep, share: st.share, weeks: st.weeks });
function applyScenario() { for (const r of rows) r.plan = M.buildFarmPlan(r.p, r.implied, sc()); }

const KEYS = { rank: (r) => -r.rank, name: (r) => r.p.name.toLowerCase(), tvl: (r) => r.p.tvl_usd, c7: (r) => r.p.change_7d ?? -1e9, age: (r) => r.f.ageDays ?? -1,
  odds: (r) => r.odds, launch: (r) => r.mult * r.p.tvl_usd, implied: (r) => r.implied, net: (r) => r.plan.net, ph: (r) => r.plan.perHour };
function visibleRows() {
  const t = st.text.toLowerCase(), k = KEYS[st.sort];
  return rows.filter((r) => (st.verdict === 'All' || r.plan.verdict === st.verdict) && (st.tier === 'All' || r.tier === st.tier) && (!st.cat || (r.p.category ?? 'None') === st.cat)
    && (!st.chain || r.p.chains.includes(st.chain)) && (!t || `${r.p.name} ${r.p.category} ${r.p.chains.join(' ')}`.toLowerCase().includes(t)))
    .sort((a, b) => { const u = k(a), v = k(b); return (u < v ? 1 : u > v ? -1 : a.rank - b.rank) * st.dir; });
}

function renderKpis(vis) {
  const vb = V.steps[0], ob = O.steps[0], f = vis.filter((r) => r.plan.verdict === 'FARM').length, m = vis.filter((r) => r.plan.verdict === 'MARGINAL').length;
  const card = (h, v, s, c = '') => `<div class="kpi"><h3>${h}</h3><b class="${c}">${v}</b><p>${s}</p></div>`;
  return `<section class="kpis">${[
    card('Out-of-sample miss · walk-forward', `${x(V.best.wf)}`, `vs ${x(vb.wf)} flat; left-out ${x(V.best.loo)} vs ${x(vb.loo)}`),
    card('Is the printed range honest?', `${pct(V.calib.wf50)} · ${pct(V.calib.wf80)}`, 'newer caps inside P25–P75 · P10–P90 (stated 50% · 80%)'),
    card('Token odds · Brier, walk-forward', O.best.wf.toFixed(3), `vs ${ob.wf.toFixed(3)} base rate; ${pct(O.best.wfAcc)} of newer peers right`),
    card('Terms that survived both tests', `${V.terms.length}/5 · ${O.terms.length}/5`, 'value · odds; the negative control failed both'),
    card('Worth farming, this scenario', `${f} of ${vis.length}`, `${m} marginal, ${vis.length - f - m} skip; FARM beats $15/h after gas & fees`, 'pos'),
    card('Watchlist ranked', `${S.watchlist.length} / ${S.watchlist.length}`, `+${rows.length - S.watchlist.length} pre-token rows, early or off-list`),
  ].join('')}</section>`;
}

const LEDGER = [['watch', 'Ranked · watchlist', 'c1'], ['early', 'Ranked · early, below $50M', 'c2'], ['off', 'Ranked · off-list', 'c3'], ['trade', 'Token trades · priced comp', 'c4'],
  ['recorded', 'Token recorded · no cap', 'c5'], ['bridge', 'Out · bridge', 'c6'], ['lst', 'Out · liquid staking', 'c7'], ['cex', 'Out · exchange', 'c8'], ['wrap', 'Out · versioned or wrapped', 'c9']];
function renderLedger() {
  const n = S.protocols.length, bar = LEDGER.map(([k, , c]) => `<i class="${c}" style="width:${(ledger[k] / n) * 100}%"></i>`).join('');
  return `<section class="card"><h2>Protocol accounting <em>${n} of ${n}, each in one group</em></h2><div class="lbar">${bar}</div>
    <ul class="legend">${LEDGER.map(([k, l, c]) => `<li><i class="${c}"></i>${l}<b>${ledger[k] ?? 0}</b></li>`).join('')}</ul></section>`;
}

function evidenceTable(a, isOdds) {
  const f = (v) => (isOdds ? v.toFixed(3) : x(v)), lab = (t) => (t === 'base' ? (isOdds ? 'base rate of peers' : 'flat median multiple') : R.TERMS[t]);
  return `<table class="ev"><tr><th>Term, in order</th><th>${isOdds ? '10-fold' : 'Leave-1-out'}</th><th>Walk-fwd</th><th></th></tr>${a.steps.map((s) =>
    `<tr><td>${lab(s.term)}</td><td>${f(s.loo)}</td><td>${f(s.wf)}</td><td class="${s.status === 'kept' ? 'pos' : s.term === 'ctrl' || s.status === 'baseline' ? 'mut' : 'neg'}">${s.status}</td></tr>`).join('')}</table>`;
}
function renderEvidence() {
  const c = V.calib;
  return `<section class="card"><h2>Out-of-sample evidence <em>kept only if both tests improve</em></h2>
    <h4>Value if a token launches · typical miss, ${V.n} traded tokens</h4>${evidenceTable(V, false)}
    <h4>Token odds · Brier (lower is better), ${O.n} standalone peers, ${O.pos} record a token</h4>${evidenceTable(O, true)}
    <p class="cal">Range check: P25–P75 holds <b>${pct(c.loo50)}</b> left-out / <b>${pct(c.wf50)}</b> newer; P10–P90 <b>${pct(c.loo80)}</b> / <b>${pct(c.wf80)}</b>; within ×3 <b>${pct(c.looX3)}</b> / <b>${pct(c.wfX3)}</b>. Size slope ${V.model.b[0]?.toFixed(2)} ± ${V.se?.[0]?.toFixed(2)} (s.e., 120 bootstrap refits).</p></section>`;
}

/** Market cap vs TVL, log-log: grey traded comps, cyan fitted size curve with its P25–P75 band, amber board top 12. */
function renderScatter() {
  const W = 404, H = 196, l = 34, b = 18, X0 = 6.5, X1 = 10.5, Y0 = 4.5, Y1 = 11;
  const px = (v) => l + ((v - X0) / (X1 - X0)) * (W - l - 6), py = (v) => H - b - ((v - Y0) / (Y1 - Y0)) * (H - b - 6);
  const curve = (off) => [X0, X1].map((t) => `${px(t)},${py(t + M.linear(V.model, M.columns({ size: t - 8, cat: '', mom: 0, age: 0, ch: 0, ctrl: 0 }, V.terms, V.levels)) + off)}`);
  const dots = V.D.map((d) => `<circle cx="${px(Math.log10(d.tvl)).toFixed(1)}" cy="${py(Math.log10(d.p.mcap_usd)).toFixed(1)}" r="2.3" class="cp"><title>${esc(d.p.name)}</title></circle>`).join('');
  const top = rows.slice(0, 12).map((r) => `<circle cx="${px(Math.log10(r.p.tvl_usd)).toFixed(1)}" cy="${py(Math.log10(r.implied)).toFixed(1)}" r="3.2" class="tp"><title>${esc(r.p.name)}</title></circle>`).join('');
  const grid = [7, 8, 9, 10].map((t) => `<line x1="${px(t)}" x2="${px(t)}" y1="6" y2="${H - b}"/><text x="${px(t)}" y="${H - 5}">${['$10M', '$100M', '$1B', '$10B'][t - 7]}</text>`).join('')
    + [5, 7, 9, 11].map((t) => `<line x1="${l}" x2="${W - 6}" y1="${py(t)}" y2="${py(t)}"/><text x="${l - 4}" y="${py(t) + 3}" class="ya">${['$100k', '$10M', '$1B', '$100B'][(t - 5) / 2]}</text>`).join('');
  return `<section class="card sc"><h2>Market cap vs TVL <em>log-log · ${V.n} traded tokens</em></h2><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="market cap against TVL">
    <g class="gr">${grid}</g><polygon class="band" points="${[...curve(V.q.p25), ...curve(V.q.p75).reverse()].join(' ')}"/><polyline class="fit" points="${curve(0).join(' ')}"/>${dots}${top}</svg>
    <p class="key"><i class="cp"></i>traded comps <i class="fitk"></i>fitted curve ± P25–P75 <i class="tp"></i>board top 12, implied</p></section>`;
}

const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${key}:${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function renderControls() {
  const n = (v) => rows.filter((r) => v === 'All' || r.plan.verdict === v).length, cats = [...new Set(rows.map((r) => r.p.category ?? 'None'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.p.chains))].sort(), opt = (a, cur, all) => `<option value="">${all}</option>` + a.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  return `<div class="bar">${seg('verdict', ['All', 'FARM', 'MARGINAL', 'SKIP'].map((v) => [v, `${v === 'All' ? 'All' : v[0] + v.slice(1).toLowerCase()} <s>${n(v)}</s>`]))}
    ${seg('tier', [['All', 'All tiers'], ['watch', 'Watchlist'], ['early', 'Early &lt;$50M'], ['off', 'Off-list']])}
    <input id="find" placeholder="Search name, chain, category" value="${esc(st.text)}"><select data-key="cat">${opt(cats, st.cat, 'All categories')}</select><select data-key="chain">${opt(chains, st.chain, 'All chains')}</select></div>
    <div class="bar"><label>Deposit</label>${seg('dep', [['plan', 'Plan 0.02% TVL'], [1000, '$1,000'], [5000, '$5,000'], [25000, '$25,000']])}
    <label>Drop share</label>${seg('share', [[0.05, '5%'], [0.075, '7.5%'], [0.1, '10%']])}<label>Horizon</label>${seg('weeks', [[12, '12w'], [26, '26w'], [52, '52w']])}
    <button data-act="reset">Reset</button><button data-act="csv">CSV</button><button data-act="json">JSON</button></div>`;
}

function renderTable(vis) {
  const lo = Math.log10(rows[rows.length - 1].implied * 10 ** V.q.p25), hi = Math.log10(rows[0].implied * 10 ** V.q.p75), span = (v) => ((Math.log10(v) - lo) / (hi - lo)) * 100;
  const th = (k, l, c = '') => `<th data-sort="${k}" class="${c}${st.sort === k ? ' on' : ''}">${l}${st.sort === k ? (st.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const body = vis.map((r) => {
    const a = span(r.implied * 10 ** V.q.p25), z = span(r.implied * 10 ** V.q.p75), P = r.plan;
    return `<tr data-slug="${esc(r.p.slug)}"><td class="rk">${r.rank}<small>${r.rankLo}–${r.rankHi}</small></td>
      <td class="pn"><b>${esc(r.p.name)}</b> <span class="tg ${r.tier}">${TIER[r.tier]}</span><small>${esc(r.p.category ?? 'No category')} · ${esc(r.p.chains[0] ?? '')}${r.p.chains.length > 1 ? ' +' + (r.p.chains.length - 1) : ''}</small></td>
      <td>${big(r.p.tvl_usd)}</td><td class="${cls(r.p.change_7d)}">${sgn(r.p.change_7d)}</td><td>${age(r.f.ageDays)}</td>
      <td><span class="ob"><i style="width:${pct(r.odds)}"></i></span>${pct(r.odds)}</td><td>${big(r.mult * r.p.tvl_usd)}</td>
      <td class="iv"><b>${big(r.implied)}</b><span class="rb"><i style="left:${a}%;width:${z - a}%"></i><u style="left:${span(r.implied)}%"></u></span><small>${big(r.implied * 10 ** V.q.p25)}–${big(r.implied * 10 ** V.q.p75)}</small></td>
      <td><span class="pill ${P.verdict}">${P.verdict}</span> <b class="${cls(P.net)}">${net(P.net)}</b><small>${usd(P.slice)} drop − ${usd(P.fees)}</small></td><td class="${cls(P.perHour)}">${net(P.perHour)}</td></tr>`;
  }).join('');
  return `<table class="board"><thead><tr>${th('rank', '# · range')}${th('name', 'Protocol', 'l')}${th('tvl', 'TVL')}${th('c7', '7D')}${th('age', 'No-token age')}${th('odds', 'Token odds')}${th('launch', 'If it launches')}${th('implied', 'Implied · P25–P75')}${th('net', 'Verdict · net of fees')}${th('ph', 'Net / hour')}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderBoardView() {
  const vis = visibleRows(), filtered = st.verdict !== 'All' || st.tier !== 'All' || st.cat || st.chain || st.text;
  const t = vis.reduce((a, r) => a + r.implied, 0), tv = vis.reduce((a, r) => a + r.p.tvl_usd, 0);
  const chips = `<div class="th"><span id="status">${vis.length} of ${rows.length} rows · ${big(tv)} TVL · ${big(t)} implied</span>${filtered || st.sort !== 'rank' ? `<span class="chip">${[st.verdict !== 'All' && st.verdict + ' verdict', st.tier !== 'All' && TIER[st.tier], st.cat, st.chain, st.text && `“${esc(st.text)}”`].filter(Boolean).join(' · ') || 'All rows'} · sorted by ${st.sort === 'ph' ? 'net / hour' : st.sort}, ${st.dir > 0 ? 'high to low' : 'low to high'}</span>` : ''}</div>`;
  const ribbon = `<div class="ribbon">${integrity.map(([ok, t]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</span>`).join('')}</div>`;
  return `<div class="split"><div class="main">${renderKpis(vis)}${ribbon}${renderControls()}<div class="tw">${chips}${renderTable(vis)}</div></div>
    <aside>${renderLedger()}${renderEvidence()}${renderScatter()}</aside></div>`;
}

function contributions(model, terms, levels, f) {
  const c = M.columns(f, terms, levels), out = []; let j = 0;
  for (const t of terms) { const w = t === 'cat' ? levels.length : 1; let v = 0; for (let k = 0; k < w; k++, j++) v += model.b[j] * c[j]; out.push([t, v]); }
  return out;
}
function nearestPeers(r) {
  const lt = Math.log10(r.p.tvl_usd), all = V.D.map((d, j) => ({ d, c: V.comps[j], gap: Math.abs(Math.log10(d.tvl) - lt) + (d.p.category === r.p.category ? 0 : 1.5) }));
  return all.sort((a, b) => a.gap - b.gap).slice(0, 7);
}

function renderDetail(r) {
  const P = r.plan, vc = contributions(V.model, V.terms, V.levels, r.f), oc = contributions(O.model, O.terms, O.levels, r.f), dropped = V.steps.filter((s) => s.status === 'not kept');
  const line = (h, s, v, c = '') => `<tr class="${c}"><td><b>${h}</b><small>${s}</small></td><td>${v}</td></tr>`, gl = { age: `age ${age(r.f.ageDays)}`, size: `TVL ${big(r.p.tvl_usd)}`, mom: `7d ${sgn(r.p.change_7d)}`, cat: esc(r.p.category ?? 'no category'), ch: `${r.p.chains.length} chains` };
  let cum = 0;
  const steps = P.steps.map((s, i) => { cum += s.cost; return `<li><i>${i + 1}</i><div><b>${s.tag}</b> ${esc(s.text)}<p><span>COST ${usd(s.cost)}</span><span>TIME ${s.min >= 120 ? (s.min / 60).toFixed(1) + ' h' : s.min + ' min'}</span><span>CUMULATIVE ${usd(cum)}</span></p></div></li>`; }).join('');
  const peers = nearestPeers(r).map(({ d, c }) => `<tr><td>${esc(d.p.name)} <small>${esc(d.p.symbol ?? '')}</small></td><td>${esc((d.p.category ?? '').slice(0, 16))}</td><td>${big(d.tvl)}</td><td>${big(d.p.mcap_usd)}</td><td>${x(10 ** d.y)}</td><td>${x(10 ** c.held)}</td><td class="${Math.abs(d.y - c.held) < Math.log10(3) ? 'pos' : 'neg'}">${x(10 ** (d.y - c.held))}</td></tr>`).join('');
  const tile = (h, v, c = '') => `<div><h5>${h}</h5><b class="${c}">${v}</b></div>`;
  return `<div class="crumb"><a href="#" data-act="back">← Board</a> / ${esc(r.p.name)}</div><div class="detail"><div class="col">
    <section class="card hd"><div><p class="am">#${r.rank} of ${rows.length} by implied value · rank ${r.rankLo}–${r.rankHi} across 120 bootstrap refits</p><h1>${esc(r.p.name)}</h1>
      <p class="tags"><span class="tg ${r.tier}">${TIER[r.tier]}</span><span class="pill ${P.verdict}">${P.verdict}</span>${[r.p.category ?? 'No category', ...r.p.chains.slice(0, 4)].map((c) => `<span class="tg">${esc(c)}</span>`).join('')}</p>
      <div class="stats">${tile('TVL', big(r.p.tvl_usd))}${tile('7-day change', sgn(r.p.change_7d), cls(r.p.change_7d))}${tile('Listed since', r.p.listed_at ?? 'n/a')}${tile('No-token age', age(r.f.ageDays))}</div></div>
      <div class="ivc"><h5>Implied value · a model estimate</h5><b>${usd(r.implied)}</b><div class="stats">${tile('If a token launches', big(r.mult * r.p.tvl_usd))}${tile('Token odds', pct(r.odds))}${tile('P25–P75', big(r.implied * 10 ** V.q.p25) + '–' + big(r.implied * 10 ** V.q.p75))}${tile('P10–P90', big(r.implied * 10 ** V.q.p10) + '–' + big(r.implied * 10 ** V.q.p90))}</div>
      <p class="pos">✓ Recomputed in this browser: equals board.json. No token on record is not proof of none; the odds are its peers' record.</p></div></section>
    <section class="card"><h2>How the figure is made</h2><table class="dc">
      ${line('TVL', `DefiLlama, ${S.as_of}`, big(r.p.tvl_usd))}
      ${line('Base multiple', `fitted on ${V.n} traded tokens, read at $100M TVL; held-out miss ${x(V.best.loo)} left-out, ${x(V.best.wf)} walk-forward`, x(10 ** V.model.c0))}
      ${vc.map(([t, v]) => line(R.TERMS[t].slice(2), t === 'size' ? `slope ${V.model.b[0].toFixed(2)} ± ${V.se[0].toFixed(2)} × log10(${big(r.p.tvl_usd)} / $100M)` : 'ridge-shrunk', x(10 ** v))).join('')}
      ${line('= Value if a token launches', `TVL × ${x(r.mult)}; half of held-out caps fall in ${big(r.mult * r.p.tvl_usd * 10 ** V.q.p25)}–${big(r.mult * r.p.tvl_usd * 10 ** V.q.p75)}`, big(r.mult * r.p.tvl_usd), 'am')}
      ${line('× Token odds', `peers' record (${O.pos} of ${O.n} record a token): ${oc.map(([t, v]) => `${gl[t]} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`).join(', ')} in log-odds from base ${O.model.c0.toFixed(2)}`, pct(r.odds))}
      ${r.famF < 1 ? line('× Family factor', `off-list: a token family already exists (${R.fam.fresh} of ${R.fam.kin} kin tokens were a new ticker)`, x(r.famF)) : ''}
      ${line('= Implied value', `rank ${r.rankLo}–${r.rankHi} across bootstrap refits of both models`, big(r.implied), 'am')}
    </table><p class="note">Tested, not used in the value: ${dropped.map((s) => `${R.TERMS[s.term].slice(2)} (${x(s.loo)}, ${x(s.wf)})`).join('; ')}.</p></section>
    <section class="card"><h2>Nearest traded peers · their tokens trade</h2><table class="pt"><tr><th>Token</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Cap / TVL</th><th>Held-out fit</th><th>Actual ÷ fit</th></tr>${peers}</table></section></div>
    <div class="col"><section class="card"><h2>Farm verdict <span class="pill ${P.verdict}">${P.verdict}</span><em>${usd(P.deposit)} deposit · ${pct(st.share, 1)} drop share · ${P.weeks} weeks · on ${esc(P.chain)}</em></h2>
      <p class="vs ${P.verdict}">${P.verdict}: ${usd(P.deposit)} for ${P.weeks} weeks buys a modelled drop of ${usd(P.slice)} for ${usd(P.fees)} of gas and fees and ${P.hours.toFixed(1)} h of work: <b>${net(P.net)} net (${net(P.perHour)}/h)</b>. Fees are covered while the drop share stays above ${pct(P.breakEvenShare, 2)}; the same money in a 4% T-bill earns ${usd(P.tbill)}.</p>
      <div class="tiles">${tile('At risk', usd(P.deposit))}${tile('Gas + fees', usd(P.fees))}${tile('Modelled drop', usd(P.slice))}${tile('Net of fees', net(P.net), cls(P.net))}${tile('Hands-on', P.hours.toFixed(1) + ' h')}${tile('Net per hour', net(P.perHour), cls(P.perHour))}</div>
      <p class="note">Drop = implied value × drop share × deposit ÷ TVL = ${big(r.implied)} × ${pct(st.share, 1)} × ${usd(P.deposit)} ÷ ${big(r.p.tvl_usd)}. FARM: net positive and at least $15 an hour; SKIP: gas and fees exceed the drop.</p></section>
    <section class="card"><h2>Net of fees by drop share × deposit <em>${P.weeks} weeks; the live scenario is outlined</em></h2>${sensitivityGrid(r)}</section>
    <section class="card"><h2>Costed farm plan · ${P.steps.length} steps <em>gas at ${usd(P.gas)} a transaction on ${esc(P.chain)}</em></h2><ol class="steps">${steps}</ol></section>
    <section class="card"><h2>Risks the figures carry</h2><ul class="risk"><li>Odds ${pct(r.odds)}: ${pct(1 - r.odds)} of peers like it record no token, so the drop can be zero; the ${usd(P.fees)} of fees is the sure loss.</li><li>P10–P90 spans ×${(10 ** (V.q.p90 - V.q.p10)).toFixed(0)}: size the deposit to what you can lose, not to the midpoint.</li><li>TVL moved ${sgn(r.p.change_7d)} in the week; the exit rule fires at ${big(r.p.tvl_usd * 0.75)}. Contract risk is never priced here.</li></ul></section></div></div>`;
}

/** What the same plan nets at each drop share and deposit size: where the verdict flips. */
function sensitivityGrid(r) {
  const deps = ['plan', 1000, 5000, 25000], cell = (sh, d) => { const p = M.buildFarmPlan(r.p, r.implied, { ...sc(), dep: d, share: sh }); return `<td class="${p.verdict}${sh === st.share && d === st.dep ? ' cur' : ''}">${net(p.net)}<small>${net(p.perHour)}/h</small></td>`; };
  const planDep = M.buildFarmPlan(r.p, r.implied, { ...sc(), dep: 'plan' }).deposit;
  return `<table class="sg"><tr><th>Share</th>${deps.map((d) => `<th>${d === 'plan' ? 'Plan ' + usd(planDep) : usd(d)}</th>`).join('')}</tr>${[0.05, 0.075, 0.1].map((sh) => `<tr><th>${pct(sh, 1)}</th>${deps.map((d) => cell(sh, d)).join('')}</tr>`).join('')}</table>`;
}

const table = (cols, body) => `<table class="pt"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
function renderComps() {
  const list = V.D.map((d, j) => ({ d, c: V.comps[j] })).sort((a, b) => b.d.p.mcap_usd - a.d.p.mcap_usd);
  return `<section class="card wide"><h2>Traded comps · ${V.n} tokens price the model <em>cap ÷ family TVL (every protocol carrying the ticker); never ranked</em></h2>${table(['Token', 'Category', 'Family TVL', 'Market cap', 'Cap / TVL', 'Fitted', 'Held-out fit', 'Actual ÷ held-out'],
    list.map(({ d, c }) => [`${esc(d.p.name)} <small>${esc(d.p.symbol ?? '')}</small>`, esc(d.p.category ?? ''), big(d.tvl), big(d.p.mcap_usd), x(10 ** d.y), x(10 ** c.fit), x(10 ** c.held), x(10 ** (d.y - c.held))]))}</section>`;
}
function renderAside() {
  const why = { cex: 'exchange custody', bridge: 'bridge', lst: 'liquid staking / restaking', wrap: 'versioned or wrapped' };
  const list = S.protocols.map((p, i) => [p, R.cls[i]]).filter(([, c]) => why[c]).sort((a, b) => b[0].tvl_usd - a[0].tvl_usd);
  return `<section class="card wide"><h2>Set aside · ${list.length} without a token that are not launches <em>plus ${ledger.trade + ledger.recorded} that record one</em></h2>${table(['Protocol', 'Category', 'TVL', 'Reason (house rule, applied below the floor too)'],
    list.map(([p, c]) => [esc(p.name), esc(p.category ?? ''), big(p.tvl_usd), why[c]]))}</section>`;
}

function render() {
  const r = st.slug && rows.find((x) => x.p.slug === st.slug), tab = (k, l) => `<button data-set="tab:${k}" class="${st.tab === k && !r ? 'on' : ''}">${l}</button>`;
  app.innerHTML = `<header><div class="logo"><i></i><div><h1>Launch Radar Apex</h1><p>pre-token protocols · implied value = TVL × fitted multiple (if a token launches) × token odds (peers' record)</p></div></div>
    <nav class="seg">${tab('board', `Board <s>${rows.length}</s>`)}${tab('comps', `Traded comps <s>${V.n}</s>`)}${tab('aside', `Set aside <s>${ledger.cex + ledger.bridge + ledger.lst + ledger.wrap}</s>`)}</nav>
    <p class="meta">DefiLlama snapshot <b>${S.as_of}</b> · ${S.protocols.length} protocols · model refitted in this browser · no network</p></header>
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

// Screenshot views: ?view=board, ?view=detail (top FARM watchlist row), ?view=filtered.
applyScenario();
const view = q.get('view');
if (view === 'detail') st.slug = q.get('p') || (rows.find((r) => r.tier === 'watch' && r.plan.verdict === 'FARM') || rows[0]).p.slug;
if (view === 'filtered') Object.assign(st, { verdict: 'FARM', sort: 'ph', dir: 1 });
render();
document.body.setAttribute('aria-busy', 'false');
window.__RADAR_READY__ = true;
})();
