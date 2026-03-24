const https = require('https');
const http = require('http');

const SOURCE_API = 'https://living-telecommunications-start-consoles.trycloudflare.com/api/txmd5';
const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 1000;
const FETCH_INTERVAL = 3000;

// ── HELPERS ──
function NR(v) {
  if (!v) return 'X';
  const s = v.toString().toLowerCase().trim();
  return (s==='tài'||s==='tai'||s==='t') ? 'T' : 'X';
}
function OPP(c) { return c==='T' ? 'X' : 'T'; }

function curStk(arr) {
  if (!arr.length) return {char:'T',count:0};
  const l=arr[arr.length-1]; let n=0;
  for (let i=arr.length-1;i>=0;i--) { if(arr[i]===l) n++; else break; }
  return {char:l,count:n};
}
function calcTM(arr) {
  let TT=0,TX=0,XT=0,XX=0;
  for (let i=0;i<arr.length-1;i++) {
    const a=arr[i],b=arr[i+1];
    if(a==='T'&&b==='T')TT++; else if(a==='T')TX++;
    else if(b==='T')XT++; else XX++;
  }
  const sT=TT+TX||1,sX=XT+XX||1;
  return {TT:Math.round(TT/sT*100),TX:Math.round(TX/sT*100),XT:Math.round(XT/sX*100),XX:Math.round(XX/sX*100)};
}
function prevStk(arr) {
  if (arr.length<2) return {char:'T',count:0};
  const cur=arr[arr.length-1]; let e=arr.length-1;
  while(e>0&&arr[e]===cur) e--;
  const p=arr[e]; let c=0;
  for (let i=e;i>=0;i--) { if(arr[i]===p) c++; else break; }
  return {char:p,count:c};
}
function getGroups(arr) {
  const g=[]; let cur=null,c=0;
  for (const x of arr) {
    if(x===cur) c++;
    else { if(c>0) g.push({char:cur,len:c}); cur=x; c=1; }
  }
  if(c>0) g.push({char:cur,len:c});
  return g;
}

// ══════════════════════════════════════════════════════
// ── ADAPTIVE PATTERN LIBRARY ──
// Tự động phát hiện, đánh giá, thêm/xóa cầu theo thời gian thực
// ══════════════════════════════════════════════════════
const patternLib = {
  // patterns[key] = {seq, next, win, loss, weight, lastSeen, active}
  patterns: {},

  // Quét toàn bộ lịch sử tìm pattern mới có acc >= threshold
  discover(pat, minSamples=6, minAcc=0.65) {
    const n = pat.length;
    if (n < 20) return;

    // 1. Sequence patterns (độ dài 2-9)
    for (let seqLen = 2; seqLen <= 9; seqLen++) {
      if (n < seqLen + minSamples) continue;
      // Chỉ xét trigger = chuỗi cuối cùng
      const trigger = pat.slice(-seqLen).join('');
      const outcomes = {T:0, X:0};
      for (let i=0; i<=n-seqLen-1; i++) {
        if (pat.slice(i,i+seqLen).join('') === trigger) {
          outcomes[pat[i+seqLen]]++;
        }
      }
      const total = outcomes.T + outcomes.X;
      if (total < minSamples) continue;
      const best = outcomes.T >= outcomes.X ? 'T' : 'X';
      const acc = outcomes[best] / total;
      if (acc >= minAcc) {
        const key = `seq_${trigger}`;
        if (!this.patterns[key]) {
          this.patterns[key] = {seq:trigger, seqLen, next:best, win:0, loss:0,
            weight: acc * 1.5, lastSeen: Date.now(), active:true,
            desc:`Seq(${seqLen}) ${trigger}→${best} acc=${Math.round(acc*100)}%`};
        } else {
          // Cập nhật next nếu thay đổi
          this.patterns[key].next = best;
          this.patterns[key].weight = Math.min(3.0, acc * 1.5);
          this.patterns[key].lastSeen = Date.now();
          this.patterns[key].active = true;
        }
      }
    }

    // 2. Group patterns (A-B-A, A-B-C symmetry)
    const groups = getGroups(pat);
    if (groups.length >= 4) {
      const last4 = groups.slice(-4);
      // Pattern A-B-A-B (alternating groups)
      if (last4[0].len===last4[2].len && last4[1].len===last4[3].len) {
        const key = `grp_alt_${last4[0].len}_${last4[1].len}`;
        const next = last4[3].char; // tiếp tục nhóm cuối
        if (!this.patterns[key]) {
          this.patterns[key] = {seq:key, seqLen:0, next, win:0, loss:0,
            weight:1.2, lastSeen:Date.now(), active:true,
            desc:`GroupAlt ${last4[0].len}-${last4[1].len}-${last4[0].len}-${last4[1].len}`};
        }
      }
      // Pattern A-B-A (symmetric)
      const last3 = groups.slice(-3);
      if (last3[0].len===last3[2].len && last3[0].len>=2) {
        const key = `grp_sym_${last3[0].len}_${last3[1].len}`;
        const next = last3[2].char;
        if (!this.patterns[key]) {
          this.patterns[key] = {seq:key, seqLen:0, next, win:0, loss:0,
            weight:1.3, lastSeen:Date.now(), active:true,
            desc:`GroupSym ${last3[0].len}-${last3[1].len}-${last3[2].len}`};
        }
      }
    }

    // 3. Streak-break patterns
    const sk = curStk(pat);
    const ps = prevStk(pat);
    if (sk.count >= 2 && ps.count >= 3) {
      const key = `stk_break_${ps.count}_${sk.count}`;
      if (!this.patterns[key]) {
        // Sau streak dài rồi break ngắn → thường tiếp tục break
        const next = sk.count <= 2 ? OPP(sk.char) : sk.char;
        this.patterns[key] = {seq:key, seqLen:0, next, win:0, loss:0,
          weight:1.0, lastSeen:Date.now(), active:true,
          desc:`StkBreak prev=${ps.count} cur=${sk.count}→${next}`};
      }
    }

    // 4. Periodic patterns (chu kỳ lặp)
    for (let period = 2; period <= 6; period++) {
      if (n < period * 4) continue;
      const recent = pat.slice(-period*3);
      let matches = 0;
      for (let i=0; i<period*2; i++) {
        if (recent[i] === recent[i+period]) matches++;
      }
      const periodAcc = matches / (period*2);
      if (periodAcc >= 0.75) {
        const key = `period_${period}`;
        const next = pat[n - period]; // dự đoán theo chu kỳ
        if (!this.patterns[key]) {
          this.patterns[key] = {seq:key, seqLen:period, next, win:0, loss:0,
            weight: periodAcc * 1.4, lastSeen:Date.now(), active:true,
            desc:`Period(${period}) acc=${Math.round(periodAcc*100)}%→${next}`};
        } else {
          this.patterns[key].next = next;
          this.patterns[key].lastSeen = Date.now();
        }
      }
    }

    // Dọn pattern cũ không còn active (>2h không thấy)
    const now = Date.now();
    Object.keys(this.patterns).forEach(k => {
      if (now - this.patterns[k].lastSeen > 2*60*60*1000) {
        this.patterns[k].active = false;
      }
    });
  },

  // Học từ kết quả thực tế
  learn(predictedNext, actualNext) {
    const ok = predictedNext === actualNext;
    Object.values(this.patterns).forEach(p => {
      if (!p.active) return;
      if (p.next === predictedNext) {
        if (ok) {
          p.win++;
          p.weight = Math.min(3.0, p.weight + 0.08);
        } else {
          p.loss++;
          p.weight = Math.max(0.05, p.weight - 0.12);
          // Nếu pattern liên tục sai → đảo chiều
          const total = p.win + p.loss;
          if (total >= 8 && p.loss/total > 0.65) {
            p.next = OPP(p.next);
            p.win = 0; p.loss = 0;
            p.weight = 0.5;
          }
        }
      }
    });
  },

  // Lấy vote từ tất cả active patterns
  getVotes() {
    const votes = {T:0, X:0};
    const active = Object.values(this.patterns).filter(p => p.active && p.weight > 0.1);
    active.forEach(p => { votes[p.next] += p.weight; });
    return {votes, count: active.length};
  },

  getStats() {
    const all = Object.values(this.patterns);
    const active = all.filter(p => p.active);
    return {total: all.length, active: active.length,
      top: active.sort((a,b)=>b.weight-a.weight).slice(0,5).map(p=>p.desc)};
  }
};

// ══════════════════════════════════════════════════════
// ── 84 STATIC MODELS ──
// ══════════════════════════════════════════════════════
function modelNames() {
  const maj=['M_StreakFollow','M_StreakBreak','M_Transition','M_MeanRevert','M_Freq3',
    'M_Freq4','M_Freq5','M_Wave','M_ZigZag','M_DoubleAlt','M_Triple','M_LongFollow',
    'M_LongBreak','M_ShortBet','M_Balance','M_TrendUp','M_TrendDn','M_Sym545',
    'M_Sym454','M_GroupAna','M_HistBias'];
  const mini=['m_s2','m_s3','m_s4','m_s6','m_s7','m_s8','m_a2','m_a3','m_w2','m_w3',
    'm_w4','m_p2','m_p3','m_p4','m_p5','m_p6','m_t1','m_t2','m_t3','m_t4','m_t5'];
  const aux=Array.from({length:42},(_,i)=>'a'+(i+1));
  return [...maj,...mini,...aux];
}
function initWeights() { const w={}; modelNames().forEach(m=>w[m]=1.0); return w; }

// ── ENGINE STATE ──
let engineState = {
  weights: initWeights(),
  predHist: [],
  win: 0, loss: 0,
  failStreak: 0, antiActive: false,
  lastPred: null
};

function predict84(pat, tm, sk, cntT, cntX) {
  const n=pat.length; const last=pat[n-1];
  const votes={}; let sT=0,sX=0;
  function add(m,c,mult=1) {
    const w=(engineState.weights[m]||1.0)*mult;
    votes[m]=c;
    if(c==='T') sT+=w; else sX+=w;
  }
  function tw(){return last==='T'?(tm.TT>=50?'T':'X'):(tm.XX>=50?'X':'T');}

  // 21 MAJOR
  if(sk.count>=3){const fp=last==='T'?tm.TT:tm.XX;add('M_StreakFollow',fp>=50?last:OPP(last),fp>=60?1.5:1.0);}
  else add('M_StreakFollow',tw(),1.0);
  if(sk.count>=6) add('M_StreakBreak',OPP(last),1.2); else add('M_StreakBreak',last,0.8);
  add('M_Transition',tw(),1.3);
  const d=cntT-cntX;
  if(Math.abs(d)>=8) add('M_MeanRevert',d<0?'T':'X',1.2); else add('M_MeanRevert',last,0.8);
  [3,4,5].forEach((pl,i)=>{
    const mn=['M_Freq3','M_Freq4','M_Freq5'][i];
    if(n>=pl+2){const p=pat.slice(-pl).join('');let h=[];for(let j=0;j<n-pl-1;j++){if(pat.slice(j,j+pl).join('')===p)h.push(pat[j+pl]);}
    if(h.length>=3){const fT=h.filter(x=>x==='T').length;add(mn,fT>=h.length/2?'T':'X',1.1);}else add(mn,last,0.7);}else add(mn,last,0.7);
  });
  const l6p=pat.slice(-6);let ac=0;for(let i=1;i<l6p.length;i++)if(l6p[i]!==l6p[i-1])ac++;
  if(ac>=4) add('M_Wave',OPP(last),1.2); else add('M_Wave',last,0.9);
  const l4p=pat.slice(-4).join('');
  if(l4p==='TXTX'||l4p==='XTXT') add('M_ZigZag',OPP(last),1.2); else add('M_ZigZag',last,0.8);
  if(l4p==='TTXX'||l4p==='XXTT') add('M_DoubleAlt',last,1.0); else add('M_DoubleAlt',last,0.8);
  const l6s=pat.slice(-6).join('');
  if(/^T{3}/.test(l6s)||/^X{3}/.test(l6s)){const ch=l6s[0];add('M_Triple',sk.count===3?ch:OPP(ch),1.1);}else add('M_Triple',last,0.8);
  add('M_LongFollow',last,sk.count>=4?1.2:0.9);
  add('M_LongBreak',sk.count>=5?OPP(last):last,sk.count>=5?1.0:0.7);
  add('M_ShortBet',tw(),sk.count<=1?1.0:0.8);
  if(cntT<44) add('M_Balance','T',1.1); else if(cntX<44) add('M_Balance','X',1.1); else add('M_Balance',last,0.8);
  const l10=pat.slice(-10),t10=l10.filter(x=>x==='T').length;
  add('M_TrendUp',t10>=7?'T':'X',1.0);
  add('M_TrendDn',t10<=3?'X':'T',1.0);
  if(n>=14){const s14=pat.slice(-14);const u1=[...new Set(s14.slice(0,5))],u3=[...new Set(s14.slice(-5))];
  if(u1.length===1&&u3.length===1&&u1[0]===u3[0]) add('M_Sym545',u3[0],1.2); else add('M_Sym545',last,0.8);}else add('M_Sym545',last,0.8);
  if(n>=12){const s12=pat.slice(-12);const h1=[...new Set(s12.slice(0,4))],h2=[...new Set(s12.slice(4,8))],h3=[...new Set(s12.slice(8))];
  if(h1.length===1&&h2.length===1&&h3.length===1&&h1[0]!==h2[0]&&h2[0]!==h3[0]) add('M_Sym454',h3[0],1.1); else add('M_Sym454',last,0.8);}else add('M_Sym454',last,0.8);
  const gs=getGroups(pat.slice(-30));
  if(gs.length>=3){const lastL=gs[gs.length-1].len,avgL=gs.reduce((s,g)=>s+g.len,0)/gs.length;add('M_GroupAna',lastL>=avgL?OPP(last):last,1.0);}else add('M_GroupAna',last,0.8);
  add('M_HistBias',cntT>=cntX?'T':'X',0.9);

  // 21 MINI
  const miniPl=[2,3,4,6,7,8,2,3,2,3,4,2,3,4,5,6,1,2,3,4,5];
  ['m_s2','m_s3','m_s4','m_s6','m_s7','m_s8','m_a2','m_a3','m_w2','m_w3','m_w4','m_p2','m_p3','m_p4','m_p5','m_p6','m_t1','m_t2','m_t3','m_t4','m_t5']
  .forEach((m,i)=>{
    const pl=miniPl[i]||2;
    if(n>=pl+1){const p=pat.slice(-pl).join('');let h=[];for(let j=0;j<n-pl-1;j++)if(pat.slice(j,j+pl).join('')===p)h.push(pat[j+pl]);
    if(h.length>=2){const fT=h.filter(x=>x==='T').length;add(m,fT>=h.length/2?'T':'X',0.8);}else add(m,last,0.6);}else add(m,last,0.6);
  });

  // 42 AUX
  for(let i=1;i<=42;i++){
    const m='a'+i,w=2+(i%8);
    if(n>=w+1){const seg=pat.slice(-w);const tR=seg.filter(x=>x==='T').length/seg.length;
    let v;if(i%3===0) v=tR>0.5?'T':'X';else if(i%3===1) v=tw();else v=sk.count>=(2+(i%4))?last:OPP(last);
    add(m,v,0.5);}else add(m,last,0.4);
  }

  return {votes, sT, sX};
}

// ══════════════════════════════════════════════════════
// ── MAIN PREDICTION ENGINE ──
// Kết hợp 84 models + adaptive pattern library
// ══════════════════════════════════════════════════════
function computePrediction(pat) {
  if (pat.length < 5) return null;
  const l100 = pat.slice(-100);
  const cT = l100.filter(x=>x==='T').length;
  const cX = 100 - cT;
  const sk = curStk(pat);
  const tm = calcTM(l100);

  // Chạy 84 models
  const m84 = predict84(pat, tm, sk, cT, cX);
  let sT = m84.sT, sX = m84.sX;

  // Cộng thêm votes từ adaptive pattern library
  patternLib.discover(pat);
  const libVotes = patternLib.getVotes();
  sT += libVotes.votes.T;
  sX += libVotes.votes.X;

  // ANTI-FAIL
  if (engineState.antiActive && engineState.failStreak >= 2) {
    const rawW = sT >= sX ? 'T' : 'X';
    if (OPP(rawW) === 'T') sT += 8; else sX += 8;
    engineState.antiActive = false;
  }

  const tot = sT + sX || 1;
  const win = sT >= sX ? 'T' : 'X';
  const conf = Math.min(0.72, Math.max(0.50, Math.max(sT,sX)/tot));
  const pct = Math.round(conf * 100);
  const stars = pct >= 65 ? '⭐⭐⭐' : pct >= 57 ? '⭐⭐' : '⭐';

  // Tìm pattern nổi bật nhất để hiển thị reason
  const patStats = patternLib.getStats();
  const reason = patStats.top.length > 0 ? patStats.top[0] : `84 Models`;

  return {char:win, confidence:pct, stars, votes:m84.votes, reason,
    patternCount: patStats.active, sT, sX};
}

// ── WEIGHT LEARNING ──
function weightLearn(phien, ketQua) {
  if (!engineState.lastPred) return;
  const {phien:predPhien, char:predChar, votes} = engineState.lastPred;
  if (String(predPhien) !== String(phien)) return;
  if (engineState.predHist.find(h=>h.phien===phien)) return;

  const actual = NR(ketQua);
  const ok = predChar === actual;
  engineState.predHist.push({phien, predicted:predChar, actual, correct:ok});
  if (engineState.predHist.length > 500) engineState.predHist = engineState.predHist.slice(-500);

  // Học weight 84 models
  if (ok) {
    engineState.win++;
    engineState.failStreak = 0;
    engineState.antiActive = false;
    if (votes) Object.entries(votes).forEach(([m,v]) => {
      if (v===predChar && engineState.weights[m]!==undefined)
        engineState.weights[m] = Math.min(3.0, engineState.weights[m]+0.1);
    });
  } else {
    engineState.loss++;
    engineState.failStreak++;
    if (engineState.failStreak >= 2) engineState.antiActive = true;
    if (votes) Object.entries(votes).forEach(([m,v]) => {
      if (v===predChar && engineState.weights[m]!==undefined)
        engineState.weights[m] = Math.max(0.1, engineState.weights[m]-0.15);
    });
  }

  // Học adaptive patterns
  patternLib.learn(predChar, actual);

  const total = engineState.win + engineState.loss;
  const acc = total > 0 ? (engineState.win/total*100).toFixed(1) : 0;
  const libStats = patternLib.getStats();
  console.log(`[LEARN] Phiên ${phien}: dự=${predChar} thực=${actual} ${ok?'✓':'✗'} | Acc=${acc}% (${engineState.win}/${total}) | Patterns=${libStats.active}`);
}

// ── STATE ──
let history = [];
let lastPhien = null;
let lastData = null;
let cachedPrediction = null;
let predictionDirty = true;

function getPrediction() {
  if (predictionDirty || !cachedPrediction) {
    const pat = history.map(d => NR(d.ket_qua));
    const result = computePrediction(pat);
    if (result && history.length > 0) {
      const last = history[history.length-1];
      const nextPhien = last.phien + 1;
      engineState.lastPred = {phien:nextPhien, char:result.char, votes:result.votes};
      const total = engineState.win + engineState.loss;
      cachedPrediction = {
        phien_dudoan: nextPhien,
        du_doan: result.char==='T' ? 'Tài' : 'Xỉu',
        do_tin_cay: result.confidence,
        stars: result.stars,
        reason: result.reason,
        pattern_count: result.patternCount,
        server_stats: {
          total: total,
          win: engineState.win,
          loss: engineState.loss,
          accuracy: total>0 ? parseFloat((engineState.win/total*100).toFixed(1)) : null,
          fail_streak: engineState.failStreak,
          anti_active: engineState.antiActive,
          patterns_active: result.patternCount
        }
      };
    }
    predictionDirty = false;
  }
  return cachedPrediction;
}

// ── FETCH SOURCE ──
function fetchSource() {
  const url = new URL(SOURCE_API);
  const lib = url.protocol==='https:' ? https : http;
  const req = lib.get(SOURCE_API, {timeout:5000}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        lastData = data;
        const phien = data.phien;
        const ket_qua = data.ket_qua;
        if (phien !== lastPhien && ket_qua && (ket_qua==='Tài'||ket_qua==='Xỉu')) {
          weightLearn(phien, ket_qua);
          history.push({phien, ket_qua, tong:data.tong,
            xuc_xac_1:data.xuc_xac_1, xuc_xac_2:data.xuc_xac_2, xuc_xac_3:data.xuc_xac_3,
            update_at:data.update_at});
          if (history.length > MAX_HISTORY) history.shift();
          lastPhien = phien;
          predictionDirty = true;
          console.log(`[${new Date().toLocaleTimeString()}] Phiên ${phien}: ${ket_qua}`);
        }
      } catch(e) { console.error('Parse error:', e.message); }
    });
  });
  req.on('error', e => console.error('Fetch error:', e.message));
  req.on('timeout', () => { req.destroy(); console.error('Timeout'); });
}

setInterval(fetchSource, FETCH_INTERVAL);
fetchSource();

// ── HTTP SERVER ──
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method==='OPTIONS') { res.writeHead(204); res.end(); return; }
  const path = req.url.split('?')[0];

  if (path==='/api/history') {
    res.writeHead(200);
    res.end(JSON.stringify({history, current:lastData, count:history.length, updated:new Date().toISOString()}));

  } else if (path==='/api/prediction') {
    const pred = getPrediction();
    res.writeHead(pred?200:503);
    res.end(JSON.stringify(pred||{error:'Chưa đủ dữ liệu'}));

  } else if (path==='/api/full') {
    const pred = getPrediction();
    res.writeHead(200);
    res.end(JSON.stringify({history, prediction:pred, current:lastData, count:history.length, updated:new Date().toISOString()}));

  } else if (path==='/api/patterns') {
    // Xem tất cả patterns đang active
    const active = Object.values(patternLib.patterns)
      .filter(p=>p.active)
      .sort((a,b)=>b.weight-a.weight)
      .map(p=>({desc:p.desc, next:p.next, weight:parseFloat(p.weight.toFixed(3)), win:p.win, loss:p.loss}));
    res.writeHead(200);
    res.end(JSON.stringify({count:active.length, patterns:active}));

  } else if (path==='/api/current') {
    res.writeHead(200);
    res.end(JSON.stringify(lastData||{}));

  } else if (path==='/'||path==='/health') {
    const pred = getPrediction();
    const total = engineState.win + engineState.loss;
    res.writeHead(200);
    res.end(JSON.stringify({
      status:'ok', history_count:history.length, last_phien:lastPhien,
      prediction: pred ? `${pred.du_doan} ${pred.stars} (${pred.do_tin_cay}%)` : null,
      engine: {win:engineState.win, loss:engineState.loss,
        accuracy: total>0 ? parseFloat((engineState.win/total*100).toFixed(1)) : null},
      patterns: patternLib.getStats()
    }));

  } else {
    res.writeHead(404);
    res.end(JSON.stringify({error:'Not found'}));
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Endpoints: /api/history | /api/prediction | /api/full | /api/patterns | /health`);
});
