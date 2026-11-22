/* Launch Radar Apex v4: shared Node + browser engine. Every term stays only if it improves BOTH CV and walk-forward. */
(function(root){
'use strict';
const L10=Math.log10,clip=(v,a,b)=>Math.min(b,Math.max(a,v));
const VERSIONED=/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/,WRAPWORD=/\b(wrapped|staked|staking)\b/i;
const EXCHANGE=/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const BRIDGE=['Bridge','Canonical Bridge'],LST=['Liquid Staking','Liquid Restaking','Restaked BTC'];
const TERMS={size:'+ size curve, log TVL',huber:'+ Huber robust weights (d=0.65)',fam:'+ category family (ridge 16)',cat:'+ category effect (ridge 64)',
  catO:'+ category effect (ridge 16)',mom:'+ 7-day TVL growth',age:'+ age, years listed',lnTvl:'+ protocol size, ln TVL',ch:'+ chain count, log',ctrl:"+ control: another row's 7d"};
const L_FAM=16,L_CAT_VAL=64,L_CAT_ODDS=16,HUBER_D=0.65,BOOT=200,SEED=20261114;
const recorded=(p)=>p.gecko_id!==null||p.symbol!==null||p.mcap_usd!==null;
const ruleOut=(p)=>p.category==='CEX'||EXCHANGE.test(p.name)?'cex':BRIDGE.includes(p.category)?'bridge':LST.includes(p.category)?'lst':VERSIONED.test(p.name)||WRAPWORD.test(p.name)?'wrap':null;
function catFamily(cat){
  const c=(cat||'Other').toLowerCase();
  return /dex|amm|swap|liquidity|pool|farm|launchpad|otc/.test(c)?'DEX & Trading':/lend|borrow|credit|cdp|stable|collateral|basis/.test(c)?'Lending & Credit'
    :/deriv|perp|option|predict|synthet/.test(c)?'Derivatives':/yield|vault|curator|allocator|restak|staking/.test(c)?'Vaults & Yield'
    :/rwa|payment|insur/.test(c)?'RWA & Finance':'Other DeFi';
}
const first=(n)=>n.toLowerCase().split(/[\s\-.]+/)[0];
const median=(a)=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0;};
const quant=(a,q)=>{const s=[...a].sort((x,y)=>x-y),i=q*(s.length-1),lo=Math.floor(i);return s[lo]+(s[Math.min(lo+1,s.length-1)]-s[lo])*(i-lo);};
const byListing=(a,b)=>(a.listed_at??'')<(b.listed_at??'')?-1:(a.listed_at??'')>(b.listed_at??'')?1:a.slug<b.slug?-1:1;

/** Partitions all snapshot protocols into exactly one bucket for full accounting. */
function classifyProtocols(s){
  const wl=new Set(s.watchlist);
  return s.protocols.map((p)=>{const ro=ruleOut(p);return recorded(p)?(!ro&&p.mcap_usd>0?'trade':'recorded'):wl.has(p.slug)?'watch':ro||(p.tvl_usd>=s.floor_usd?'off':'early');});
}

function features(s,maxAge){
  const asOf=Date.parse(s.as_of+'T00:00:00Z'),n=s.protocols.length;
  return s.protocols.map((p,i)=>{
    const ad=p.listed_at?Math.max(0,(asOf-Date.parse(p.listed_at+'T00:00:00Z'))/864e5):null,o=s.protocols[(i+(n>>1))%n];
    return {size:L10(p.tvl_usd)-8,lnTvl:Math.log(p.tvl_usd/1e8),mom:clip(p.change_7d??0,-50,100)/100,age:ad===null?maxAge:ad/365,
      ageDays:ad,ch:Math.log2(1+p.chains.length),ctrl:clip(o.change_7d??0,-50,100)/100,cat:p.category??'None',fam:catFamily(p.category)};
  });
}

const columns=(f,terms,lv)=>{const r=[];for(const t of terms){if(t==='cat'||t==='catO')for(const l of lv.cat)r.push(f.cat===l?1:0);else if(t==='fam')for(const l of lv.fam)r.push(f.fam===l?1:0);else r.push(f[t]);}return r;};
const penalties=(terms,lv,cp)=>{const r=[];for(const t of terms){if(t==='cat'||t==='catO')for(const _ of lv.cat)r.push(cp);else if(t==='fam')for(const _ of lv.fam)r.push(L_FAM);else r.push(1e-4);}return r;};

function solve(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let piv=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[piv][c]))piv=r;
    [M[c],M[piv]]=[M[piv],M[c]];
    for(let r=c+1;r<n;r++){const k=M[r][c]/M[c][c];if(k)for(let j=c;j<=n;j++)M[r][j]-=k*M[c][j];}
  }
  const x=new Array(n).fill(0);for(let r=n-1;r>=0;r--){let v=M[r][n];for(let j=r+1;j<n;j++)v-=M[r][j]*x[j];x[r]=v/M[r][r];}
  return x;
}

function fitWeightedRidge(X,y,pen,w){
  const n=X.length,k=pen.length;if(!k)return {c0:median(y),b:[]};
  let sw=0,my=0;const mx=new Array(k).fill(0);
  for(let i=0;i<n;i++){const wi=w?w[i]:1;sw+=wi;my+=wi*y[i];for(let j=0;j<k;j++)if(X[i][j])mx[j]+=wi*X[i][j];}
  my/=sw;for(let j=0;j<k;j++)mx[j]/=sw;
  const A=pen.map((p,i)=>pen.map((_,j)=>(i===j?p:0))),v=new Array(k).fill(0);
  for(let i=0;i<n;i++){const wi=w?w[i]:1,r=X[i],dy=y[i]-my;for(let a=0;a<k;a++){const da=r[a]-mx[a];v[a]+=wi*da*dy;for(let b=0;b<k;b++)A[a][b]+=wi*da*(r[b]-mx[b]);}}
  const b=solve(A,v);let c0=my;for(let j=0;j<k;j++)c0-=b[j]*mx[j];return {c0,b};
}

/** Huber IRLS ridge regression (delta=0.65) damping extreme market-cap outliers. */
function fitHuberRidge(X,y,pen,delta=HUBER_D,iters=15){
  const n=X.length,k=pen.length;if(!k)return {c0:median(y),b:[]};
  let w=new Array(n).fill(1),m={c0:median(y),b:new Array(k).fill(0)};
  for(let it=0;it<iters;it++){m=fitWeightedRidge(X,y,pen,w);w=y.map((yi,i)=>{const r=Math.abs(yi-linear(m,X[i]));return r<=delta?1:delta/Math.max(r,1e-9);});}
  return m;
}
const fitVal=(X,y,pen,h)=>(h?fitHuberRidge(X,y,pen):fitWeightedRidge(X,y,pen));

/** Ridge logistic regression via Newton steps with sparse one-hot skip and optional warm start. */
function fitLogit(X,y,pen,init){
  const n=X.length,k=pen.length,rate=clip(y.reduce((a,v)=>a+v,0)/n,0.01,0.99);
  let c0=init?init.c0:Math.log(rate/(1-rate)),b=init?[...init.b]:new Array(k).fill(0);
  for(let it=0;it<20;it++){
    const H=Array.from({length:k+1},()=>new Array(k+1).fill(0)),g=new Array(k+1).fill(0);
    for(let i=0;i<n;i++){
      const r=X[i],p=sigmoid(linear({c0,b},r)),w=Math.max(p*(1-p),1e-9),e=y[i]-p;g[0]+=e;H[0][0]+=w;
      for(let a=0;a<k;a++){const ra=r[a];if(!ra)continue;const wra=w*ra;g[a+1]+=e*ra;H[0][a+1]+=wra;for(let c=a;c<k;c++)if(r[c])H[a+1][c+1]+=wra*r[c];}
    }
    for(let a=0;a<=k;a++)for(let c=0;c<a;c++)H[a][c]=H[c][a];
    for(let a=0;a<k;a++){H[a+1][a+1]+=pen[a];g[a+1]-=pen[a]*b[a];}
    const d=solve(H,g);c0+=d[0];b=b.map((v,j)=>v+d[j+1]);if(Math.max(...d.map(Math.abs))<1e-8)break;
  }
  return {c0,b};
}
function linear(m,x){let v=m.c0;for(let j=0;j<x.length;j++)if(x[j])v+=m.b[j]*x[j];return v;}
function sigmoid(v){return 1/(1+Math.exp(-clip(v,-30,30)));}

function testValuation(D,terms,lv,huber){
  const X=D.map((d)=>columns(d.f,terms,lv)),y=D.map((d)=>d.y),pen=penalties(terms,lv,L_CAT_VAL),n=D.length;
  const predAt=(tr,xi)=>terms.length?linear(fitVal(tr.map((j)=>X[j]),tr.map((j)=>y[j]),pen,huber),xi):median(tr.map((j)=>y[j]));
  const idx=D.map((_,i)=>i),loo=idx.map((i)=>y[i]-predAt(idx.filter((j)=>j!==i),X[i])),order=idx.slice().sort((a,b)=>byListing(D[a].p,D[b].p)),wf=[];
  let in50=0,in80=0;
  for(let k=Math.ceil(n/2);k<n;k++){
    const tr=order.slice(0,k),i=order[k],fit=terms.length?fitVal(tr.map((t)=>X[t]),tr.map((t)=>y[t]),pen,huber):null;
    const mid=median(tr.map((t)=>y[t])),at=(x)=>(fit?linear(fit,x):mid),r=y[i]-at(X[i]);
    const res=terms.length===1&&!lv.cat.includes(terms[0])?tr.map((ti,j)=>y[ti]-predAt(tr.filter((_,u)=>u!==j),X[ti])):tr.map((t)=>(y[t]-at(X[t]))*Math.sqrt((k+1)/Math.max(1,k-pen.length-1)));
    wf.push(r);in50+=r>=quant(res,0.25)&&r<=quant(res,0.75);in80+=r>=quant(res,0.1)&&r<=quant(res,0.9);
  }
  const miss=(a)=>10**median(a.map(Math.abs)),x3=(a)=>a.filter((r)=>Math.abs(r)<L10(3)).length/a.length;
  return {loo:miss(loo),wf:miss(wf),looRes:loo,wfCover50:in50/wf.length,wfCover80:in80/wf.length,looX3:x3(loo),wfX3:x3(wf),wfN:wf.length};
}

function testOdds(D,terms,lv){
  const X=D.map((d)=>columns(d.f,terms,lv)),y=D.map((d)=>d.y),pen=penalties(terms,lv,L_CAT_ODDS),n=D.length;
  const run=(tr,te)=>{const m=terms.length?fitLogit(tr.map((i)=>X[i]),tr.map((i)=>y[i]),pen):null,rt=tr.reduce((a,i)=>a+y[i],0)/tr.length;return te.map((i)=>[y[i],m?sigmoid(linear(m,X[i])):rt]);};
  const sc=(pr)=>({brier:pr.reduce((a,[t,p])=>a+(t-p)**2,0)/pr.length,acc:pr.filter(([t,p])=>(p>=0.5)===(t===1)).length/pr.length});
  const idx=D.map((_,i)=>i),cv=[];for(let f=0;f<10;f++)cv.push(...run(idx.filter((i)=>i%10!==f),idx.filter((i)=>i%10===f)));
  const ord=idx.slice().sort((a,b)=>byListing(D[a].p,D[b].p)),st=Math.ceil(n/2),wf=[];
  for(let k=0;k<5;k++)wf.push(...run(ord.slice(0,st+Math.floor((k*(n-st))/5)),ord.slice(st+Math.floor((k*(n-st))/5),st+Math.floor(((k+1)*(n-st))/5))));
  const a=sc(cv),b=sc(wf);return {loo:a.brier,wf:b.brier,cvAcc:a.acc,wfAcc:b.acc};
}

/** Part A: Huber-robust log-log valuation fitted on clean standalone traded tokens (92 comps). */
function fitValuationModel(s,F,cls){
  const famTvl={},catCounts={},D=[];
  s.protocols.forEach((p)=>{if(recorded(p)&&p.category!=='CEX'){const k=(p.symbol??p.gecko_id??'').toUpperCase();famTvl[k]=(famTvl[k]??0)+p.tvl_usd;}});
  s.protocols.forEach((p,i)=>{if(cls[i]==='trade'){const tvl=famTvl[(p.symbol??p.gecko_id??'').toUpperCase()]??p.tvl_usd;D.push({i,p,tvl,f:{...F[i],size:L10(tvl)-8},y:L10(p.mcap_usd/tvl)});catCounts[p.category??'None']=(catCounts[p.category??'None']??0)+1;}});
  const lv={cat:[...new Set(D.map((d)=>d.f.cat))].sort(),fam:[...new Set(D.map((d)=>d.f.fam))].sort()};
  let kept=[],useHuber=false,cur=testValuation(D,[],lv,false);
  const steps=[{term:'base',loo:cur.loo,wf:cur.wf,status:'baseline',extra:cur}];
  const s1=testValuation(D,['size'],lv,false),ok1=s1.loo<cur.loo&&s1.wf<cur.wf;
  steps.push({term:'size',loo:s1.loo,wf:s1.wf,status:ok1?'kept':'tested, not kept',extra:s1});if(ok1){kept=['size'];cur=s1;}
  const sH=testValuation(D,kept,lv,true),okH=kept.length&&sH.loo<cur.loo&&sH.wf<cur.wf;
  steps.push({term:'huber',loo:sH.loo,wf:sH.wf,status:okH?'kept':'tested, not kept',extra:sH});if(okH){useHuber=true;cur=sH;}
  for(const t of['cat','fam','mom','age','ch']){const c=testValuation(D,[...kept,t],lv,useHuber),ok=c.loo<cur.loo&&c.wf<cur.wf;steps.push({term:t,loo:c.loo,wf:c.wf,status:ok?'kept':'tested, not kept',extra:c});if(ok){kept.push(t);cur=c;}}
  const sC=testValuation(D,[...kept,'ctrl'],lv,useHuber);steps.push({term:'ctrl',loo:sC.loo,wf:sC.wf,status:sC.loo<cur.loo&&sC.wf<cur.wf?'chance win, unused':'must not help',extra:sC});
  const model=kept.length?fitVal(D.map((d)=>columns(d.f,kept,lv)),D.map((d)=>d.y),penalties(kept,lv,L_CAT_VAL),useHuber):{c0:median(D.map((d)=>d.y)),b:[]};
  const r=cur.looRes,q={p10:quant(r,0.1),p25:quant(r,0.25),p75:quant(r,0.75),p90:quant(r,0.9)};
  const comps=D.map((d,j)=>({i:d.i,tvl:d.tvl,fit:linear(model,columns(d.f,kept,lv)),held:d.y-r[j],y:d.y}));
  const cov=(lo,hi)=>r.filter((v)=>v>=lo&&v<=hi).length/r.length;
  return {terms:kept,useHuber,lv,model,steps,best:cur,q,comps,n:D.length,D,catCounts,calib:{loo50:cov(q.p25,q.p75),loo80:cov(q.p10,q.p90),wf50:cur.wfCover50,wf80:cur.wfCover80,looX3:cur.looX3,wfX3:cur.wfX3}};
}

/** Part B: peer token-recording survival curve across all 442 standalone protocols. */
function fitTokenOddsModel(s,F,maxAge){
  const D=[];s.protocols.forEach((p,i)=>{if(!ruleOut(p))D.push({i,p,f:F[i],y:recorded(p)?1:0});});
  const lv={cat:[...new Set(D.map((d)=>d.f.cat))].sort(),fam:[...new Set(D.map((d)=>d.f.fam))].sort()};
  let kept=[],cur=testOdds(D,[],lv);const steps=[{term:'base',loo:cur.loo,wf:cur.wf,status:'baseline',extra:cur}];
  for(const t of['age','catO','lnTvl','mom','ch']){const c=testOdds(D,[...kept,t],lv),ok=c.loo<cur.loo&&c.wf<cur.wf;steps.push({term:t,loo:c.loo,wf:c.wf,status:ok?'kept':'tested, not kept',extra:c});if(ok){kept.push(t);cur=c;}}
  const sC=testOdds(D,[...kept,'ctrl'],lv);steps.push({term:'ctrl',loo:sC.loo,wf:sC.wf,status:sC.loo<cur.loo&&sC.wf<cur.wf?'chance win, unused':'must not help',extra:sC});
  const model=fitLogit(D.map((d)=>columns(d.f,kept,lv)),D.map((d)=>d.y),penalties(kept,lv,L_CAT_ODDS));
  const bins=[['0-6m',0,0.5],['6-12m',0.5,1],['1-2y',1,2],['2-3y',2,3],['3-5y',3,6]].map(([label,lo,hi])=>{const sub=D.filter((d)=>d.p.listed_at&&d.f.age>=lo&&d.f.age<hi);return {label,n:sub.length,rate:sub.length?sub.filter((d)=>d.y).length/sub.length:0,undated:false};});
  const und=D.filter((d)=>!d.p.listed_at);if(und.length)bins.push({label:'pre',n:und.length,rate:und.filter((d)=>d.y).length/und.length,undated:true});
  return {terms:kept,lv,model,steps,best:cur,n:D.length,pos:D.filter((d)=>d.y).length,maxAge,bins,D};
}

function familyFactor(s){
  const fam={};s.protocols.forEach((p)=>{if(!ruleOut(p))(fam[first(p.name)]??=[]).push(p);});
  let kin=0,fresh=0,multi=0,withTok=0;
  for(const g of Object.values(fam)){if(g.length<2)continue;multi++;const t=g.filter(recorded);if(t.length)withTok++;if(t.length>1)for(const p of t){kin++;if(!t.some((o)=>o!==p&&(o.symbol??o.gecko_id)===(p.symbol??p.gecko_id)))fresh++;}}
  const fr=kin?fresh/kin:1,q=multi?withTok/multi:0;
  return {kin,fresh,multi,withTok,kinFactor:fr,parentFactor:1-q+q*fr,words:new Set(s.protocols.filter((p)=>!ruleOut(p)&&recorded(p)).map((p)=>first(p.name)))};
}

const GAS={Ethereum:2.5,Bitcoin:3,Tron:1,Cardano:0.25,Avalanche:0.08,Binance:0.06,Arbitrum:0.04,Base:0.03,Optimism:0.03,'OP Mainnet':0.03,Linea:0.05,Scroll:0.05,'zkSync Era':0.05,Starknet:0.05,Mantle:0.03,Polygon:0.02,Sonic:0.02,Sui:0.02,Berachain:0.02,Unichain:0.02,Monad:0.02,Plasma:0.05,Solana:0.01,Aptos:0.01,Near:0.01,TON:0.03,'Hyperliquid L1':0.01,Stellar:0.001,Algorand:0.001,Flare:0.02};
const ONRAMP=['Ethereum','Solana','Arbitrum','Base','Optimism','OP Mainnet','Polygon','Binance','Avalanche','Tron','Sui','Aptos','TON','Near','Stellar','Algorand','Plasma','Flare'];
const ACTION=[
  [/Dex|Liquidity|Farm/,'lp',15,0,3,1,"Swap half of {D} into the pair and add both sides to {N}'s deepest pool on {C} (3 tx), wide range for low IL",'Impermanent loss and pool fee-tier drift; stick to correlated or major pairs rather than thin pools.'],
  [/Deriv|Perp|Option|Prediction/,'perp',0,8,2,3,'Post {D} USDC margin on {N} on {C} and trade ~1x weekly as an offsetting long/short pair (0.04%/side)','Funding-rate drag and liquidation risk; keep leverage under 2x and avoid unhedged overnight exposure.'],
  [/^Chain$/,'chain',10,0,3,1,'Bridge {D} into {N} via its canonical bridge across its top lending market and main DEX','Canonical bridge delay and sequencer downtime; verify exit latency before sizing up.'],
  [/CDP|Stablecoin|Algo/,'cdp',10,0,4,2,'Post {D} collateral in {N} on {C} and mint its stable asset under 40% LTV for liquidation headroom','Liquidation and depeg risk; keep at least a 250% collateral ratio and watch redemption queues.'],
  [/Lend|Credit/,'lend',0,0,2,1,"Supply {D} USDC to {N}'s deepest market on {C} (approve + supply) with zero borrowing to avoid liquidation",'Bad-debt socialisation and utilisation spikes; avoid illiquid pools whose borrow rate pins at 100%.'],
  [/.*/,'vault',0,0,2,1,"Deposit {D} USDC (or primary asset) into {N}'s largest vault on {C} and hold the receipt token",'Stacked strategy risk: vaults route into underlying markets; avoid yield paid mostly in unlisted points.'],
];
const usd=(v)=>(v<0?'-$':'$')+(Math.abs(v)>=100?String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g,','):Math.abs(v).toFixed(2));
const big=(v)=>v>=1e9?'$'+(v/1e9).toFixed(2)+'B':v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':usd(v);

/** Costed 8-step farm plan under scenario {dep, share, weeks}. FARM beats both 4% T-bill and $25/hour. */
function buildFarmPlan(p,implied,odds,sc,exitDropPct){
  const chains=p.chains.length?p.chains:['Ethereum'],D=sc.dep==='plan'?clip(Math.round((p.tvl_usd*0.0002)/100)*100,1000,10000):sc.dep,W=sc.weeks;
  const [,kind,bpsIn,bpsWeek,txIn,perTouch,act,riskNote]=ACTION.find((a)=>a[0].test(p.category??''));
  const costOf=(c)=>(ONRAMP.includes(c)?2:7)+(4+txIn+W*perTouch+4)*(GAS[c]??0.1);
  const chain=chains.slice().sort((a,b)=>costOf(a)-costOf(b)||chains.indexOf(a)-chains.indexOf(b))[0],gas=GAS[chain]??0.1,onramp=ONRAMP.includes(chain),exitAt=p.tvl_usd*(1+exitDropPct/100);
  const fill=(t)=>t.replace(/{D}/g,usd(D)).replace(/{N}/g,p.name).replace(/{C}/g,chain);
  const steps=[
    ['SETUP',`Create a fresh farm wallet and fund $10 of ${chain} gas ${onramp?'from an exchange':'via an Ethereum bridge'} (${usd(gas)}/tx, cheapest of ${chains.length}).`,onramp?1:4,10],
    ['VERIFY',`Open ${p.name} via DefiLlama, verify contracts against official docs, and test $100 in + out before sizing up.`,4*gas,10],
    ['FUND',`Move ${usd(D)} USDC to ${chain} ${onramp?'via exchange withdrawal':'over an audited bridge'}; keep $50 liquid for gas.`,onramp?1:3,10],
    ['RISK',`${riskNote} Cap total allocation at ${((D/p.tvl_usd)*100).toFixed(4)}% of ${p.name}'s ${big(p.tvl_usd)} TVL.`,0,10],
    ['CORE',`${fill(act)}; log the entry tx hash and receipt balance.`,txIn*gas+(D*bpsIn)/1e4,15],
    ['CADENCE',`Touch weekly for ${W} weeks (${perTouch>1?'rebalance / active touch':'claim, compound or $25 top-up'}) for ${W} active weeks (${W*perTouch} tx).`,W*perTouch*gas+(W*D*bpsWeek)/1e4,5*W],
    ['EXIT RULE',`Check weekly: exit if TVL drops under ${big(exitAt)} (${exitDropPct.toFixed(1)}% vs ${big(p.tvl_usd)}), if withdrawals pause, or post-snapshot.`,2*gas,Math.max(10,2*W)],
    ['RECORD & CLAIM',`Keep a tx ledger for tax basis; claim only from ${p.name}'s verified URL and unwind after week ${W} if unlaunched.`,2*gas,15],
  ].map(([tag,text,cost,min])=>({tag,text,cost,min}));
  const fees=steps.reduce((a,t)=>a+t.cost,0),hours=steps.reduce((a,t)=>a+t.min,0)/60;
  const slice=(implied*sc.share*D)/(p.tvl_usd+D),sliceIfLaunch=slice/Math.max(odds,0.01),net=slice-fees,perHour=net/hours;
  const tbill=(D*0.04*W)/52,excess=net-tbill,excessPerHour=excess/hours,beShare=(fees*(p.tvl_usd+D))/(implied*D),beOdds=fees/Math.max(sliceIfLaunch,1e-9);
  const verdict=net>tbill&&perHour>=25?'FARM':(net<=0||net<0.2*tbill)?'SKIP':'MARGINAL';
  return {chain,gas,kind,deposit:D,weeks:W,steps,fees,hours,slice,sliceIfLaunch,net,perHour,verdict,tbill,excess,excessPerHour,breakEvenShare:beShare,breakEvenOdds:beOdds,exitAt,exitDropPct};
}
const stepLine=(t)=>`${t.tag}: ${t.text} Cost about ${usd(t.cost)}; ${t.min>=120?(t.min/60).toFixed(1)+' h':t.min+' min'}.`;
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

/** Runs full radar: 758-protocol ledger, Huber valuation & survival odds, 198 ranked rows, 200 bootstrap refits. */
function runRadar(s,sc={dep:'plan',share:0.07,weeks:12},opts={}){
  const cls=classifyProtocols(s),asOf=Date.parse(s.as_of+'T00:00:00Z');
  const ages=s.protocols.filter((p)=>p.listed_at).map((p)=>Math.max(0,(asOf-Date.parse(p.listed_at+'T00:00:00Z'))/864e5/365));
  const maxAge=ages.length?Math.max(...ages):5,ch7=s.protocols.map((p)=>p.change_7d).filter((v)=>v!==null),exitDropPct=Math.min(-10,quant(ch7,0.05));
  const F=features(s,maxAge),V=fitValuationModel(s,F,cls),O=fitTokenOddsModel(s,F,maxAge),fam=familyFactor(s);
  const condOdds=(om,f)=>{const pNow=sigmoid(linear(om,columns(f,O.terms,O.lv))),pMax=sigmoid(linear(om,columns({...f,age:Math.max(f.age,O.maxAge)},O.terms,O.lv)));return{pNow,pMax,odds:clip((pMax-pNow)/Math.max(0.05,1-pNow),0.08,0.95)};};
  const value=(vm,om,i)=>{const mult=10**linear(vm,columns(F[i],V.terms,V.lv)),co=condOdds(om,F[i]),famF=cls[i]!=='off'?1:fam.words.has(first(s.protocols[i].name))?fam.kinFactor:fam.parentFactor;return{mult,...co,famF,implied:Math.max(1,Math.round(s.protocols[i].tvl_usd*mult*co.odds*famF))};};
  const rows=s.protocols.map((p,i)=>i).filter((i)=>['watch','off','early'].includes(cls[i])).map((i)=>({i,p:s.protocols[i],f:F[i],tier:cls[i],...value(V.model,O.model,i)})).sort((a,b)=>b.implied-a.implied||(a.p.slug<b.p.slug?-1:1));
  rows.forEach((r,k)=>{r.rank=k+1;r.plan=buildFarmPlan(r.p,r.implied,r.odds,sc,exitDropPct);});
  if(opts.boot!==false){
    const rand=rng(SEED),ranks=rows.map(()=>[]),coef=[],XV=V.D.map((d)=>columns(d.f,V.terms,V.lv)),XO=O.D.map((d)=>columns(d.f,O.terms,O.lv)),pV=penalties(V.terms,V.lv,L_CAT_VAL),pO=penalties(O.terms,O.lv,L_CAT_ODDS);
    for(let b=0;b<BOOT;b++){
      const iv=V.D.map(()=>Math.floor(rand()*V.D.length)),io=O.D.map(()=>Math.floor(rand()*O.D.length));
      const vm=V.terms.length?fitVal(iv.map((j)=>XV[j]),iv.map((j)=>V.D[j].y),pV,V.useHuber):V.model,om=fitLogit(io.map((j)=>XO[j]),io.map((j)=>O.D[j].y),pO,O.model);
      coef.push({v:vm.b,o:om.b,c:vm.c0});rows.map((r,k)=>[value(vm,om,r.i).implied,k]).sort((x,y)=>y[0]-x[0]).forEach(([,k],pos)=>ranks[k].push(pos+1));
    }
    rows.forEach((r,k)=>{r.rankLo=Math.round(quant(ranks[k],0.1));r.rankHi=Math.round(quant(ranks[k],0.9));});
    const sd=(a)=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
    V.se=V.model.b.map((_,j)=>sd(coef.map((c)=>c.v[j])));V.seC0=sd(coef.map((c)=>c.c));O.se=O.model.b.map((_,j)=>sd(coef.map((c)=>c.o[j])));
  }
  const ledger={};cls.forEach((c)=>(ledger[c]=(ledger[c]??0)+1));
  return {s,cls,F,V,O,fam,rows,ledger,sc,TERMS,exitDropPct,bootN:BOOT,maxAge};
}

/** board.json rows with concrete, costed, timed farm_steps. */
function boardRows(R){
  return R.rows.map((r)=>({rank:r.rank,slug:r.p.slug,name:r.p.name,implied_value_usd:r.implied,tier:r.tier,category:r.p.category,chains:r.p.chains,
    tvl_usd:r.p.tvl_usd,change_7d:r.p.change_7d,listed_at:r.p.listed_at,value_if_launch_usd:Math.round(r.p.tvl_usd*r.mult),token_odds:+r.odds.toFixed(4),family_factor:+r.famF.toFixed(4),
    rank_range:[r.rankLo,r.rankHi],verdict:r.plan.verdict,deposit_usd:r.plan.deposit,fees_usd:+r.plan.fees.toFixed(2),net_usd:+r.plan.net.toFixed(2),excess_vs_tbill_usd:+r.plan.excess.toFixed(2),hours:+r.plan.hours.toFixed(2),farm_steps:r.plan.steps.map(stepLine)}));
}
/** FNV-1a checksum over rank:slug:value lines verified live in the browser. */
function checksum(rows){let h=0x811c9dc5;for(const r of rows)for(const ch of`${r.rank}:${r.slug}:${r.implied_value_usd}\n`){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');}
const api={runRadar,boardRows,checksum,buildFarmPlan,classifyProtocols,fitValuationModel,fitTokenOddsModel,linear,columns,sigmoid,quant,median,usd,big};
if(typeof module==='object'&&module.exports)module.exports=api;else root.RadarModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
