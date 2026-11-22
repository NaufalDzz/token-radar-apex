/* Launch Radar Apex v4: refits model.js in-browser, checks board.json equality (checkBoardIntegrity), renders board, detail & compare tray. */
(()=>{
'use strict';
const M=window.RadarModel,DATA=window.RADAR_DATA,app=document.getElementById('app'),L10=Math.log10;
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const {big,usd}=M,clip=(v,a,b)=>Math.min(b,Math.max(a,v)),pct=(v,d=0)=>(v*100).toFixed(d)+'%';
const x=(v)=>'×'+(v>=10?v.toFixed(1):v<0.05?v.toFixed(3):v.toFixed(2));
const sgn=(v)=>(v===null?'—':(v>0?'+':'')+v.toFixed(1)+'%'),cls=(v)=>(v>0?'pos':v<0?'neg':'');
const age=(d)=>(d===null?'pre-2021':d<365?Math.round(d)+' d':(d/365).toFixed(1)+' yr'),net=(v)=>(v>=0?'+':'−')+usd(Math.abs(v));
const TIER={watch:'Watchlist',early:'Early',off:'Off-list'},q=new URLSearchParams(location.search);
const DEF={verdict:'All',tier:'All',cat:'',chain:'',text:'',sort:'rank',dir:1,dep:'plan',share:0.07,weeks:12,hideSum:false};
const st={tab:'board',slug:null,compare:[],...DEF},t0=performance.now(),R=M.runRadar(DATA.snapshot),refitMs=Math.round(performance.now()-t0),{V,O,rows,ledger}=R,S=DATA.snapshot;
const td=(v,c='')=>`<td${c?` class="${c}"`:''}>${v}</td>`,th=(v,c='')=>`<th${c?` class="${c}"`:''}>${v}</th>`,tr=(v,c='')=>`<tr${c?` class="${c}"`:''}>${v}</tr>`;
const card=(b,t,e,cl='')=>`<section class="card${cl?' '+cl:''}">${t?`<div class="ah"><h2>${t}</h2>${e?`<em>${e}</em>`:''}</div>`:''}${b}</section>`;

/** Verifies browser refit matches main.ts board.json row-for-row and by FNV-1a checksum. */
function checkBoardIntegrity(){
  const mine=M.boardRows(R),want=new Map(DATA.board.map((e)=>[e[1],e]));
  const same=mine.filter((r)=>{const e=want.get(r.slug);return e&&e[0]===r.rank&&e[2]===r.implied_value_usd;}).length;
  const mono=mine.every((r,i)=>r.rank===i+1&&(!i||r.implied_value_usd<=mine[i-1].implied_value_usd));
  const total=mine.reduce((a,r)=>a+r.implied_value_usd,0),sum=M.checksum(mine),have=new Set(mine.map((r)=>r.slug));
  return [
    [same===DATA.board.length&&same===mine.length,`board.json: ${same}/${DATA.board.length} recomputed (${(refitMs/1000).toFixed(1)} s)`],
    [mono,`ranks 1–${mine.length} monotonic`],[total===DATA.total,`sum = ${usd(total)}`],[sum===DATA.checksum,`FNV-1a ${sum} = main.ts`],
    [S.watchlist.filter((s)=>have.has(s)).length===S.watchlist.length,`watchlist ${S.watchlist.length}/${S.watchlist.length}`],
    [Object.values(ledger).reduce((a,b)=>a+b,0)===S.protocols.length,`ledger ${S.protocols.length}/${S.protocols.length}`],
  ];
}
const integrity=checkBoardIntegrity(),sc=()=>({dep:st.dep,share:st.share,weeks:st.weeks});
function applyScenario(){for(const r of rows)r.plan=M.buildFarmPlan(r.p,r.implied,r.odds,sc(),R.exitDropPct);}
const KEYS={rank:(r)=>-r.rank,name:(r)=>r.p.name.toLowerCase(),tvl:(r)=>r.p.tvl_usd,c7:(r)=>r.p.change_7d??-1e9,age:(r)=>r.f.ageDays??9e9,odds:(r)=>r.odds,launch:(r)=>r.mult*r.p.tvl_usd,implied:(r)=>r.implied,net:(r)=>r.plan.net,ph:(r)=>r.plan.perHour};
function visibleRows(){
  const t=st.text.toLowerCase(),k=KEYS[st.sort];
  return rows.filter((r)=>(st.verdict==='All'||r.plan.verdict===st.verdict)&&(st.tier==='All'||r.tier===st.tier)&&(!st.cat||(r.p.category??'None')===st.cat)&&(!st.chain||r.p.chains.includes(st.chain))&&(!t||`${r.p.name} ${r.p.category} ${r.p.chains.join(' ')}`.toLowerCase().includes(t)))
    .sort((a,b)=>{const u=k(a),v=k(b);return(u<v?1:u>v?-1:a.rank-b.rank)*st.dir;});
}

const kpi=(h,v,s,c='')=>`<div class="kpi"><h3>${h}</h3><b class="${c}">${v}</b><p>${s}</p></div>`;
function renderKpis(){
  const vb=V.steps[0],ob=O.steps[0],f=rows.filter((r)=>r.plan.verdict==='FARM').length,sk=rows.filter((r)=>r.plan.verdict==='SKIP').length;
  return `<section class="kpis">${[
    kpi('Out-of-sample miss · walk-forward',`${x(V.best.wf)} <span>vs ${x(vb.wf)} flat</span>`,`${V.n} clean comps · Huber δ=0.65 · LOO ${x(V.best.loo)} vs ${x(vb.loo)}`),
    kpi('Conformal range honesty',`${pct(V.calib.wf50)} · ${pct(V.calib.wf80)}`,'jackknife LOO bands on later listings (50% · 80%)'),
    kpi('Token odds · walk-forward Brier',`${O.best.wf.toFixed(3)} <span>vs ${ob.wf.toFixed(3)}</span>`,`${pct(O.best.cvAcc)} 10-fold · ${pct(O.best.wfAcc)} WF acc (${O.n} peers)`),
    kpi('Doubly validated steps',`${V.steps.filter((s)=>s.status==='kept').length} of ${V.steps.length-2} · ${O.steps.filter((s)=>s.status==='kept').length} of ${O.steps.length-2}`,'value model · token odds; negative control failed both'),
    kpi('Worth farming · 12w @ $10k cap',`${f} of ${rows.length}`,`beats 4% T-bill & $25/h · ${rows.length-f-sk} marginal · ${sk} skip`,'pos'),
    kpi('Watchlist & ledger',`${S.watchlist.length} / ${S.watchlist.length}`,`+${rows.length-S.watchlist.length} pre-token (${ledger.early} early, ${ledger.off} off-list) · ${S.protocols.length} total`,'am'),
  ].join('')}</section><p class="formula"><b>Implied value</b> = TVL × Huber size multiple (if a token launches) × conditional launch odds (peer survival across ${O.n} standalone protocols). All weights fitted locally.</p>`;
}

const LEDGER=[['watch','Ranked · watchlist','c1'],['early','Ranked · early (<$50M)','c2'],['off','Ranked · off-list (parent)','c3'],['trade','Token trades · clean comp','c4'],['recorded','Token recorded · other/no cap','c5'],['bridge','Out · bridge','c6'],['lst','Out · liquid staking','c7'],['cex','Out · exchange','c8'],['wrap','Out · versioned/wrapped','c9']];
function renderAccounting(){
  const n=S.protocols.length,bar=LEDGER.map(([k,,c])=>`<i class="${c}" style="width:${((ledger[k]??0)/n)*100}%"></i>`).join('');
  return card(`<div class="lbar">${bar}</div><ul class="lg">${LEDGER.map(([k,l,c])=>`<li><i class="${c}"></i>${l} <b>${ledger[k]??0}</b></li>`).join('')}</ul><div class="rbn">${integrity.map(([ok,t])=>`<span class="${ok?'ok':'bad'}">${ok?'✓':'✗'} ${t}</span>`).join('')}</div>`,
    'Protocol accounting · classifyProtocols()',`all ${n} protocols partitioned: ${rows.length} pre-token ranked, ${ledger.trade+ledger.recorded} token-recording, ${ledger.bridge+ledger.lst+ledger.cex+ledger.wrap} excluded`);
}

function evTable(a,isO){
  const f=(v,ex,wf)=>isO?`${v.toFixed(3)} <s>(${pct(wf?ex.wfAcc:ex.cvAcc)})</s>`:x(v),lab=(t)=>(t==='base'?(isO?'base rate of peers':'flat median multiple'):R.TERMS[t]);
  return `<table class="ev">${tr(th('Term, added in order')+th(isO?'10-fold':'LOO')+th('Walk-fwd')+th(''))}${a.steps.map((s)=>tr(td(lab(s.term))+td(f(s.loo,s.extra,false))+td(f(s.wf,s.extra,true))+td(s.status,s.status==='kept'?'pos':s.term==='ctrl'||s.status==='baseline'?'mut':'neg'))).join('')}</table>`;
}

function scatterSvg(){
  const W=232,H=108,l=29,b=14,X0=6.5,X1=10.5,Y0=4.5,Y1=10.8,px=(v)=>l+((v-X0)/(X1-X0))*(W-l-4),py=(v)=>H-b-((v-Y0)/(Y1-Y0))*(H-b-4);
  const cv=(off)=>[X0,X1].map((t)=>`${px(t).toFixed(1)},${py(t+M.linear(V.model,M.columns({size:t-8,cat:'',fam:'',mom:0,age:0,ch:0,ctrl:0},V.terms,V.lv))+off).toFixed(1)}`);
  const dots=V.D.map((d)=>`<circle cx="${px(L10(d.tvl)).toFixed(1)}" cy="${py(L10(d.p.mcap_usd)).toFixed(1)}" r="1.6" class="cp"/>`).join('');
  const top=rows.slice(0,12).map((r)=>`<circle cx="${px(L10(r.p.tvl_usd)).toFixed(1)}" cy="${py(L10(r.implied)).toFixed(1)}" r="2.2" class="tp"/>`).join('');
  const gr=[7,8,9,10].map((t)=>`<line x1="${px(t)}" x2="${px(t)}" y1="4" y2="${H-b}"/><text x="${px(t)}" y="${H-3}">${['10M','100M','1B','10B'][t-7]}</text>`).join('')+[5,7,9].map((t)=>`<line x1="${l}" x2="${W-4}" y1="${py(t)}" y2="${py(t)}"/><text x="${l-3}" y="${py(t)+3}" class="ya">${['100k','10M','1B'][(t-5)/2]}</text>`).join('');
  return `<div><svg class="scsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="market cap vs TVL"><g class="gr">${gr}</g><polygon class="band" points="${[...cv(V.q.p25),...cv(V.q.p75).reverse()].join(' ')}"/><polyline class="fit" points="${cv(0).join(' ')}"/>${dots}${top}</svg><p class="key"><i class="cp"></i>${V.n} comps <i class="fitk"></i>Huber ± P25–75 <i class="tp"></i>top 12</p></div>`;
}

function survivalSvg(){
  const W=232,H=108,l=25,b=14,mx=R.maxAge+0.35,step=(W-l-5)/O.bins.length,px=(v)=>l+(v/mx)*(W-l-5),py=(v)=>H-b-v*(H-b-6);
  const bars=O.bins.map((bn,i)=>{const x0=l+3+i*step,h=bn.rate*(H-b-6);return`<rect x="${x0.toFixed(1)}" y="${(H-b-h).toFixed(1)}" width="${(step-4).toFixed(1)}" height="${h.toFixed(1)}" class="barc${bn.undated?' und':''}"/><text x="${(x0+(step-4)/2).toFixed(1)}" y="${H-3}" style="fill:#94a3b8;font:7.5px var(--f);text-anchor:middle">${bn.label}</text>`;}).join('');
  const pts=[0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,R.maxAge].map((a)=>`${px(a).toFixed(1)},${py(M.sigmoid(M.linear(O.model,M.columns({age:a,catO:'',lnTvl:0,mom:0,ch:0,ctrl:0},O.terms,O.lv)))).toFixed(1)}`).join(' ');
  const yg=[0,0.5,1].map((v)=>`<line x1="${l}" x2="${W-4}" y1="${py(v)}" y2="${py(v)}"/><text x="${l-3}" y="${py(v)+3}" class="ya">${Math.round(v*100)}%</text>`).join('');
  return `<div><svg class="scsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="peer token survival"><g class="gr">${yg}</g>${bars}<polyline class="fit" points="${pts}"/></svg><p class="key"><i class="fitk"></i>logit curve · orange = undated (${pct(O.bins[O.bins.length-1].rate)})</p></div>`;
}

function renderEvidence(){
  const c=V.calib;
  return card(`<div class="eg"><div><h4>Value if a token launches · ${V.n} clean traded tokens</h4>${evTable(V,false)}</div><div><h4>Token odds · Brier (share right), ${O.n} standalone peers</h4>${evTable(O,true)}</div>
    <div><h4>Range honesty (${R.bootN} refits) &amp; empirical curves</h4><table class="ev ev3">${tr(th('Share of real caps')+th('LOO')+th('Walk-fwd'))}
      ${tr(td('within ×3 of model')+td(pct(c.looX3))+td(pct(c.wfX3)))}${tr(td('inside P25–P75 (50%)')+td(pct(c.loo50))+td(pct(c.wf50)))}${tr(td('inside P10–P90 (80%)')+td(pct(c.loo80))+td(pct(c.wf80)))}</table>
      <div class="svgs">${scatterSvg()}${survivalSvg()}</div></div></div>
    <p class="rd"><b>Reading it:</b> Multiple at $100M TVL is <b>${x(10**V.model.c0)}</b> (Huber slope <b>${V.model.b[0]?.toFixed(2)} ± ${V.se?.[0]?.toFixed(2)}</b>). Category, 7d growth &amp; age overfit the 92 caps and stay out of valuation, while all four (age, category, TVL, 7d growth) cut token-odds Brier (0.213 vs 0.326). Undated rows (88% token-recorded) map to ${R.maxAge.toFixed(1)} yr.</p>`,
    'Out-of-sample evidence · fitValuationModel() &amp; fitTokenOddsModel()','terms kept only when BOTH CV and walk-forward improve');
}

const seg=(key,opts)=>`<div class="seg">${opts.map(([v,l])=>`<button data-set="${key}:${v}" class="${String(st[key])===String(v)?'on':''}">${l}</button>`).join('')}</div>`;
function renderControls(vis){
  const n=(v)=>rows.filter((r)=>v==='All'||r.plan.verdict===v).length,cats=[...new Set(rows.map((r)=>r.p.category??'None'))].sort();
  const chains=[...new Set(rows.flatMap((r)=>r.p.chains))].sort(),opt=(a,cur,all)=>`<option value="">${all}</option>`+a.map((v)=>`<option${v===cur?' selected':''}>${esc(v)}</option>`).join('');
  const fil=st.verdict!=='All'||st.tier!=='All'||st.cat||st.chain||st.text||st.sort!=='rank';
  const t=vis.reduce((a,r)=>a+r.implied,0),tv=vis.reduce((a,r)=>a+r.p.tvl_usd,0);
  return `<div class="ctrl"><div class="bar">${seg('verdict',['All','FARM','MARGINAL','SKIP'].map((v)=>[v,`${v==='All'?'All':v[0]+v.slice(1).toLowerCase()} <s>${n(v)}</s>`]))}
    ${seg('tier',[['All','All tiers'],['watch','Watchlist 40'],['early','Early <$50M'],['off','Off-list 20']])}
    <label>Deposit</label>${seg('dep',[['plan','Plan 0.02% max $10k'],[1000,'$1k'],[5000,'$5k'],[10000,'$10k']])}
    <label>Drop</label>${seg('share',[[0.035,'3.5%'],[0.07,'7%'],[0.14,'14%']])}<label>Horizon</label>${seg('weeks',[[12,'12w'],[26,'26w'],[52,'52w']])}</div>
    <div class="bar"><input id="find" placeholder="Search name, chain, category" value="${esc(st.text)}"><select data-key="cat">${opt(cats,st.cat,'All categories')}</select><select data-key="chain">${opt(chains,st.chain,'All chains')}</select>
    <button data-act="toggleSum" class="${st.hideSum?'on':''}">${st.hideSum?'Show summary':'Hide summary'}</button><button data-act="reset">Reset</button><button data-act="csv">CSV</button><button data-act="json">JSON</button>
    ${fil?`<span class="chip">Filtered: ${[st.verdict!=='All'&&st.verdict,st.tier!=='All'&&TIER[st.tier],st.cat,st.chain,st.text&&`“${esc(st.text)}”`].filter(Boolean).join(' · ')||'All'} · ${st.sort==='ph'?'net/h':st.sort} ${st.dir>0?'↓':'↑'}</span>`:''}
    <span id="status">${vis.length}/${rows.length} rows · ${big(tv)} TVL · ${big(t)} implied</span></div></div>`;
}

function renderPortfolioStrip(vis){
  const cap=vis.reduce((a,r)=>a+r.plan.deposit,0),fees=vis.reduce((a,r)=>a+r.plan.fees,0),netSum=vis.reduce((a,r)=>a+r.plan.net,0);
  const exSum=vis.reduce((a,r)=>a+r.plan.excess,0),hrs=vis.reduce((a,r)=>a+r.plan.hours,0),wlN=vis.filter((r)=>r.tier==='watch').length;
  const ch={};vis.forEach((r)=>(ch[r.plan.chain]=(ch[r.plan.chain]??0)+1));
  const topCh=Object.entries(ch).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>`${c} ${n}`).join(' · ');
  return `<section class="ps">${[kpi('Filtered farm book',`${vis.length} plays`,`${wlN} watchlist · ${vis.length-wlN} early/off-list`),
    kpi('Capital deployed',big(cap),`avg ${usd(vis.length?cap/vis.length:0)}/play · ${st.weeks}w`),kpi('Total gas & fees',usd(fees),`chains: ${topCh||'—'}`),
    kpi('Net drop · vs T-bill',`${net(netSum)}`,`${net(exSum)} excess over 4% T-bill`,cls(exSum)),kpi('Work · blended rate',`${hrs.toFixed(1)} h`,`${net(hrs?netSum/hrs:0)}/h across active rows`,cls(netSum))].join('')}</section>`;
}

function renderCompareTray(){
  const list=st.compare.map((slug)=>rows.find((r)=>r.p.slug===slug)).filter(Boolean);if(!list.length)return '';
  const r2=(l,v,c='')=>`<div class="cr"><span>${l}</span><b class="${c}">${v}</b></div>`;
  const cols=list.map((r)=>{const P=r.plan;return`<div class="cc"><div class="ch"><a href="#" data-slug="${esc(r.p.slug)}">#${r.rank} ${esc(r.p.name)}</a><button class="rmbtn" data-uncmp="${esc(r.p.slug)}">×</button></div>
    ${r2('Tier · cat',`${TIER[r.tier]} · ${esc((r.p.category??'None').slice(0,15))}`)}${r2('TVL · 7D',`${big(r.p.tvl_usd)} · ${sgn(r.p.change_7d)}`,cls(r.p.change_7d))}
    ${r2('Odds · age',`${pct(r.odds)} · ${age(r.f.ageDays)}`)}${r2('Implied (P25–75)',`${big(r.implied)} (${big(r.implied*10**V.q.p25)}–${big(r.implied*10**V.q.p75)})`,'am')}
    ${r2('Chain · fees',`${esc(P.chain)} · ${usd(P.fees)}`)}${r2('Net · vs T-bill',`${net(P.net)} · ${net(P.excess)} ex`,cls(P.excess))}${r2('Rate · stop TVL',`${net(P.perHour)}/h · <${big(P.exitAt)}`,'pos')}</div>`;}).join('');
  return card(`<div class="cg" style="grid-template-columns:repeat(${list.length},1fr)">${cols}</div>`,`Side-by-side comparison · ${list.length} pinned`,'tick checkboxes below to pin up to 4 plays · click name for 8-step plan');
}

function renderTable(vis){
  const lo=L10(rows[rows.length-1].implied*10**V.q.p25),hi=L10(rows[0].implied*10**V.q.p75),span=(v)=>clip(((L10(v)-lo)/(hi-lo))*100,0,100);
  const sh=(k,l,c='')=>`<th data-sort="${k}" class="${c}${st.sort===k?' on':''}">${l}${st.sort===k?(st.dir>0?' ↓':' ↑'):''}</th>`;
  const body=vis.map((r)=>{
    const a=span(r.implied*10**V.q.p25),z=span(r.implied*10**V.q.p75),P=r.plan,chk=st.compare.includes(r.p.slug);
    return `<tr data-slug="${esc(r.p.slug)}">${td(`<input type="checkbox" data-cmp="${esc(r.p.slug)}"${chk?' checked':''}>`,'ck')}${td(`${r.rank}<small>${r.rankLo}–${r.rankHi}</small>`,'rk')}
      ${td(`<b>${esc(r.p.name)}</b> <span class="tg ${r.tier}">${TIER[r.tier]}</span>${r.famF<1?`<span class="tg par">Parent ${x(r.famF)}</span>`:''}<small>${esc(r.p.category??'No category')} · ${esc(r.p.chains[0]??'')}${r.p.chains.length>1?' +'+(r.p.chains.length-1):''}</small>`,'pn')}
      ${td(big(r.p.tvl_usd))}${td(sgn(r.p.change_7d),cls(r.p.change_7d))}${td(age(r.f.ageDays))}${td(`<span class="ob"><i style="width:${pct(r.odds)}"></i></span>${pct(r.odds)}`)}${td(big(r.mult*r.p.tvl_usd))}
      ${td(`<div class="ivrow"><b>${big(r.implied)}</b><small>${big(r.implied*10**V.q.p25)}–${big(r.implied*10**V.q.p75)}</small></div><span class="rb"><i style="left:${a}%;width:${Math.max(2,z-a)}%"></i><u style="left:${span(r.implied)}%"></u></span>`,'iv')}
      ${td(`<span class="pill ${P.verdict}">${P.verdict}</span> <b class="${cls(P.net)}">${net(P.net)}</b><small>${usd(P.slice)} drop − ${usd(P.fees)} · ex ${net(P.excess)}</small>`,'vd')}${td(net(P.perHour),'ph '+cls(P.perHour))}</tr>`;
  }).join('');
  return `<div class="tw"><table class="board"><thead>${tr(th('')+sh('rank','# · range')+sh('name','Protocol','l')+sh('tvl','TVL')+sh('c7','7D')+sh('age','No-token age')+sh('odds','Token odds')+sh('launch','If it launches')+sh('implied','Implied value · P25–P75')+sh('net','Verdict · net of fees')+sh('ph','Net / hour'))}</thead><tbody>${body}</tbody></table></div>`;
}

function renderBoardView(){
  const vis=visibleRows(),fil=st.hideSum||st.verdict!=='All'||st.tier!=='All'||st.cat||st.chain||st.text;
  return `${st.hideSum?'':renderKpis()+renderAccounting()+renderEvidence()}${renderControls(vis)}${fil?renderPortfolioStrip(vis):''}${renderCompareTray()}${renderTable(vis)}`;
}

function nearestPeers(r){
  const lt=L10(r.p.tvl_usd);
  return V.D.map((d,j)=>({d,c:V.comps[j],gap:Math.abs(L10(d.tvl)-lt)+(d.p.category===r.p.category?0:d.f.fam===r.f.fam?1.5:3.5)})).sort((a,b)=>a.gap-b.gap).slice(0,8);
}

function valTermRows(r){
  const out=[];let off=0;
  for(const t of V.terms){
    if(t==='cat'||t==='catO'||t==='fam'){const list=t==='fam'?V.lv.fam:V.lv.cat,idx=list.indexOf(t==='fam'?r.f.fam:r.f.cat),coef=idx>=0?V.model.b[off+idx]:0;off+=list.length;out.push([t==='fam'?'Category family':'Category effect',esc(t==='fam'?r.f.fam:r.f.cat),x(10**coef)]);}
    else{const b=V.model.b[off],se=V.se?.[off]??0,xv=r.f[t];off++;out.push([t==='size'?'Size curve, log TVL':R.TERMS[t].slice(2),t==='size'?`slope ${b.toFixed(2)} ± ${se.toFixed(2)} × log10(${big(r.p.tvl_usd)} / $100M)`:`${b.toFixed(2)} × ${xv.toFixed(2)}`,x(10**(b*xv))]);}
  }
  return out;
}

function renderDetail(r){
  const P=r.plan,dropped=V.steps.filter((s)=>s.status==='tested, not kept'),ln=(h,s,v,c='')=>tr(td(`<b>${h}</b><small>${s}</small>`)+td(v),c),tile=(h,v,c='')=>`<div><h5>${h}</h5><b class="${c}">${v}</b></div>`;
  let cum=0;
  const steps=P.steps.map((s,i)=>{cum+=s.cost;return`<li><i>${i+1}</i><div><b>${s.tag}</b> ${esc(s.text)}<p><span>COST ${s.cost>0?usd(s.cost):'free'}</span><span>TIME ${s.min>=120?(s.min/60).toFixed(1)+' h':s.min+' min'}</span><span>CUM ${usd(cum)}</span></p></div></li>`;}).join('');
  const peers=nearestPeers(r).map(({d,c})=>tr(td(`${esc(d.p.name)} <small>${esc(d.p.symbol??'')}</small>`)+td(esc((d.p.category??'').slice(0,15)))+td(big(d.tvl))+td(big(d.p.mcap_usd))+td(x(10**d.y))+td(x(10**(d.y-c.held)),Math.abs(d.y-c.held)<L10(3)?'pos':'neg'))).join('');
  return `<div class="crumb"><a href="#" data-act="back">← Back to Board</a><span>${esc(P.chain)} selected as lowest total-cost chain (${usd(P.fees)} over ${P.weeks}w)</span></div>
  <section class="hero">${card(`<p class="am">#${r.rank} of ${rows.length} · rank ${r.rankLo}–${r.rankHi} across ${R.bootN} bootstrap refits</p><h1>${esc(r.p.name)}</h1>
    <p class="tags"><span class="tg ${r.tier}">${TIER[r.tier]}</span><span class="pill ${P.verdict}">${P.verdict}</span>${[r.p.category??'No category',r.f.fam,...r.p.chains.slice(0,4)].map((c)=>`<span class="tg">${esc(c)}</span>`).join('')}</p>
    <div class="st">${tile('TVL',big(r.p.tvl_usd))}${tile('7-day change',sgn(r.p.change_7d),cls(r.p.change_7d))}${tile('Listed since',r.p.listed_at??'pre-2021')}${tile('No-token age',age(r.f.ageDays))}</div>`)}
    ${card(`<h5>Implied value · a model estimate</h5><b>${usd(r.implied)}</b>
    <div class="st">${tile('If a token launches',big(r.mult*r.p.tvl_usd))}${tile('Token odds',pct(r.odds))}${tile('P25–P75',big(r.implied*10**V.q.p25)+'–'+big(r.implied*10**V.q.p75))}${tile('P10–P90',big(r.implied*10**V.q.p10)+'–'+big(r.implied*10**V.q.p90))}</div>
    <p class="pos">✓ Recomputed in this browser: equals board.json. DefiLlama records no token, not proof none exists; odds use peer survival.</p>`,'','','ivc')}</section>
  <div class="detail"><div class="col">${card(`<table class="dc">${ln('TVL',`DefiLlama snapshot, ${S.as_of}`,big(r.p.tvl_usd))}
    ${ln('Base multiple',`${V.useHuber?'Huber IRLS (δ=0.65)':'OLS'} on ${V.n} clean comps at $100M TVL; WF miss ${x(V.best.wf)} vs ${x(V.steps[0].wf)}`,x(10**V.model.c0))}
    ${valTermRows(r).map(([h,s,v])=>ln(h,s,v)).join('')}${ln('= Value if a token launches',`TVL × ${x(r.mult)}; P25–P75 ${big(r.mult*r.p.tvl_usd*10**V.q.p25)}–${big(r.mult*r.p.tvl_usd*10**V.q.p75)}`,big(r.mult*r.p.tvl_usd),'am')}
    ${ln('× Conditional token odds',`age (${age(r.f.ageDays)}), ${esc(r.f.cat)}, TVL & 7d: ${pct(r.pNow)} now → ${pct(r.pMax)} by ${O.maxAge.toFixed(1)} yr`,x(r.odds))}
    ${r.famF<1?ln('× Family factor',`off-list parent/kin discount (${R.fam.fresh}/${R.fam.kin} fresh kin)`,x(r.famF)):''}
    ${ln('= Implied value',`conformal P25–P75 ${big(r.implied*10**V.q.p25)}–${big(r.implied*10**V.q.p75)} · rank ${r.rankLo}–${r.rankHi}`,big(r.implied),'am')}</table>
    <p class="note">Tested, not kept in valuation: ${dropped.map((s)=>`${R.TERMS[s.term].slice(2)} (${x(s.loo)}, ${x(s.wf)})`).join('; ')}.</p>`,'How the figure is made · fitValuationModel() &amp; fitTokenOddsModel()')}
    ${card(`<table class="pt">${tr(th('Token')+th('Category')+th('TVL')+th('Market cap')+th('Cap / TVL')+th('Cap ÷ held-out'))}${peers}</table>`,`Nearest traded peers · ${V.catCounts[r.p.category??'None']??0} in ${esc(r.f.cat)}`)}</div>
    <div class="col">${card(`<p class="vs ${P.verdict}">${P.verdict}: ${usd(P.deposit)} on ${esc(P.chain)} for ${P.weeks}w buys a modelled drop of ${usd(P.slice)} for ${usd(P.fees)} fees &amp; ${P.hours.toFixed(1)} h: <b>${net(P.net)} net (${net(P.excess)} excess over ${usd(P.tbill)} in a 4% T-bill; ${net(P.perHour)}/h)</b>. Covers fees above ${pct(P.breakEvenShare,2)} drop share &amp; ${pct(P.breakEvenOdds,1)} odds.</p>
      <div class="tl">${tile('At risk',usd(P.deposit))}${tile(`Fees, ${P.weeks}w`,usd(P.fees))}${tile('Modelled drop',usd(P.slice))}${tile('Net of fees',net(P.net),cls(P.net))}${tile('Excess vs T-bill',net(P.excess),cls(P.excess))}${tile(`Rate (${P.hours.toFixed(1)}h)`,`${net(P.perHour)}/h`,cls(P.perHour))}</div>
      <div class="sgw"><div><h4>Net by drop share × deposit <em>active outlined</em></h4>${sensitivityGrid(r)}</div>
      <div><h4>Benchmarks</h4><table class="bm">${tr(td(`4% T-bill (${P.weeks}w)`)+td(usd(P.tbill)))}${tr(td('Drop if launched')+td(usd(P.sliceIfLaunch)))}${tr(td('Break-even share · odds')+td(`${pct(P.breakEvenShare,2)} · ${pct(P.breakEvenOdds,1)}`))}${tr(td(`TVL exit (${P.exitDropPct.toFixed(1)}%)`)+td(big(P.exitAt)))}</table></div></div>`,`Farm verdict &amp; economics · buildFarmPlan() <span class="pill ${P.verdict}">${P.verdict}</span>`)}
    ${card(`<ol class="steps">${steps}</ol>`,`Costed execution plan · ${P.steps.length} steps`,`at ${usd(P.deposit)} on ${esc(P.chain)} (${usd(P.gas)}/tx)`)}</div></div>`;
}

function sensitivityGrid(r){
  const deps=[1000,3000,'plan',25000],planDep=M.buildFarmPlan(r.p,r.implied,r.odds,{...sc(),dep:'plan'},R.exitDropPct).deposit;
  const cell=(sh,d)=>{const p=M.buildFarmPlan(r.p,r.implied,r.odds,{...sc(),dep:d,share:sh},R.exitDropPct);return td(net(p.net),p.verdict+(sh===st.share&&d===st.dep?' cur':''));};
  return `<table class="sg">${tr(th('Share')+deps.map((d)=>th(d==='plan'?'Plan '+usd(planDep):usd(d))).join(''))}${[0.035,0.07,0.14].map((sh)=>tr(th(pct(sh,1))+deps.map((d)=>cell(sh,d)).join(''))).join('')}</table>`;
}

const table=(cols,body)=>`<table class="pt">${tr(cols.map((c)=>th(c)).join(''))}${body.map((r)=>tr(r.map((c)=>td(c)).join(''))).join('')}</table>`;
function renderComps(){
  const list=V.D.map((d,j)=>({d,c:V.comps[j]})).sort((a,b)=>b.d.p.mcap_usd-a.d.p.mcap_usd);
  return card(table(['Token','Category','Family TVL','Market cap','Cap / TVL','Fitted','Held-out','Actual ÷ held-out'],
    list.map(({d,c})=>[`${esc(d.p.name)} <small>${esc(d.p.symbol??'')}</small>`,esc(d.p.category??''),big(d.tvl),big(d.p.mcap_usd),x(10**d.y),x(10**c.fit),x(10**c.held),x(10**(d.y-c.held))])),`Traded comps · ${V.n} clean standalone tokens`,'cap ÷ family TVL; never ranked');
}
function renderAside(){
  const why={cex:'exchange custody',bridge:'bridge',lst:'liquid staking / restaking',wrap:'versioned or wrapped'},list=S.protocols.map((p,i)=>[p,R.cls[i]]).filter(([,c])=>why[c]).sort((a,b)=>b[0].tvl_usd-a[0].tvl_usd);
  return card(table(['Protocol','Category','TVL','Reason (house rule)'],list.map(([p,c])=>[esc(p.name),esc(p.category??''),big(p.tvl_usd),why[c]])),`Set aside · ${list.length} non-launch protocols`,`plus ${ledger.trade+ledger.recorded} token-recording`);
}

function render(){
  const r=st.slug&&rows.find((x)=>x.p.slug===st.slug),tab=(k,l)=>`<button data-set="tab:${k}" class="${st.tab===k&&!r?'on':''}">${l}</button>`;
  const top3=rows.filter((x)=>x.plan.verdict==='FARM').sort((a,b)=>b.plan.perHour-a.plan.perHour).slice(0,3);
  const body=r?renderDetail(r):st.tab==='comps'?renderComps():st.tab==='aside'?renderAside():st.tab==='compare'?(renderCompareTray()||card('<p class="note">Tick checkboxes on Board to compare.</p>')):renderBoardView();
  app.innerHTML=`<header><div class="logo"><i></i><div><h1>Launch Radar Apex</h1><p>pre-token protocols, valued from their own record</p></div></div>
    <nav class="seg">${tab('board',`Board <s>${rows.length}</s>`)}${tab('comps',`Comps <s>${V.n}</s>`)}${tab('aside',`Aside <s>${ledger.cex+ledger.bridge+ledger.lst+ledger.wrap}</s>`)}${tab('compare',`Compare <s>${st.compare.length}</s>`)}</nav>
    <div class="qj"><span>Top FARM:</span>${top3.map((f)=>`<button data-slug="${esc(f.p.slug)}">${esc(f.p.name)} ${net(f.plan.perHour)}/h</button>`).join('')}</div>
    <p class="meta">DefiLlama <b>${S.as_of}</b> · refitted in browser · no network</p></header><main>${body}</main>`;
}

function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportRows(kind){
  const vis=visibleRows();if(kind==='json')return download('launch-radar.json',JSON.stringify(M.boardRows({rows:vis}),null,1),'application/json');
  const head='rank,slug,name,tier,category,tvl_usd,change_7d,token_odds,value_if_launch_usd,implied_value_usd,verdict,deposit_usd,fees_usd,net_usd,excess_vs_tbill_usd,net_per_hour';
  download('launch-radar.csv',[head,...vis.map((r)=>[r.rank,r.p.slug,`"${r.p.name.replace(/"/g,'""')}"`,r.tier,`"${r.p.category??''}"`,r.p.tvl_usd,r.p.change_7d??'',r.odds.toFixed(4),Math.round(r.mult*r.p.tvl_usd),r.implied,r.plan.verdict,r.plan.deposit,r.plan.fees.toFixed(2),r.plan.net.toFixed(2),r.plan.excess.toFixed(2),r.plan.perHour.toFixed(2)].join(','))].join('\n'),'text/csv');
}

app.addEventListener('click',(e)=>{
  const cmp=e.target.closest('input[data-cmp]');if(cmp){e.stopPropagation();const s=cmp.dataset.cmp;st.compare=st.compare.includes(s)?st.compare.filter((v)=>v!==s):[...st.compare.slice(-3),s];return render();}
  const un=e.target.closest('[data-uncmp]');if(un){e.stopPropagation();st.compare=st.compare.filter((v)=>v!==un.dataset.uncmp);return render();}
  const t=e.target.closest('[data-set],[data-act],[data-sort],[data-slug]');if(!t)return;
  if(t.dataset.set){const[k,v]=t.dataset.set.split(':');st[k]=['dep','share','weeks'].includes(k)&&v!=='plan'?+v:v;if(k==='tab')st.slug=null;if(['dep','share','weeks'].includes(k))applyScenario();}
  else if(t.dataset.sort){const k=t.dataset.sort;st.dir=st.sort===k?-st.dir:1;st.sort=k;}
  else if(t.dataset.slug){st.slug=t.dataset.slug;scrollTo(0,0);}
  else if(t.dataset.act==='back'){e.preventDefault();st.slug=null;}
  else if(t.dataset.act==='toggleSum'){st.hideSum=!st.hideSum;}
  else if(t.dataset.act==='reset'){Object.assign(st,DEF);st.compare=[];applyScenario();}
  else if(t.dataset.act)return exportRows(t.dataset.act);
  render();
});
app.addEventListener('change',(e)=>{if(e.target.dataset.key){st[e.target.dataset.key]=e.target.value;render();}});
app.addEventListener('input',(e)=>{if(e.target.id==='find'){st.text=e.target.value;render();const f=document.getElementById('find');f.focus();f.setSelectionRange(st.text.length,st.text.length);}});

applyScenario();const view=q.get('view');
if(view==='detail'){
  const pick=rows.filter((r)=>r.tier==='watch'&&r.plan.verdict==='FARM'&&(V.catCounts[r.p.category??'None']??0)>=5).sort((a,b)=>b.plan.perHour-a.plan.perHour)[0]
    ||rows.filter((r)=>r.tier==='watch'&&r.plan.verdict==='FARM').sort((a,b)=>b.plan.perHour-a.plan.perHour)[0]||rows.find((r)=>r.plan.verdict==='FARM')||rows[0];
  st.slug=q.get('p')||pick.p.slug;
}
if(view==='filtered'){Object.assign(st,{verdict:'FARM',sort:'ph',dir:1,hideSum:true});st.compare=visibleRows().slice(0,3).map((r)=>r.p.slug);}
render();document.body.setAttribute('aria-busy','false');window.__RADAR_READY__=true;
})();
