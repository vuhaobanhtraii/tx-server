const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

// ===== WEBSOCKET =====
let lichSu = [];
let currentSessionId = null;
let ws = null, pingInterval = null, reconnectTimeout = null, staleTimer = null;

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Origin": "https://play.sun.win"
};
const INIT_MSGS = [
  [1,"MiniGame","GM_apivopnha","WangLin",{"info":"{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}","signature":"45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"}],
  [6,"MiniGame","taixiuPlugin",{cmd:1005}],
  [6,"MiniGame","lobbyPlugin",{cmd:10001}]
];

// ===== FETCH LỊCH SỬ TỪ LC79 API =====
async function fetchLichSuLC79() {
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get('https://lc79-server-production.up.railway.app/api/lichsu', (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    if (Array.isArray(data) && data.length > 0) {
      const existing = new Set(lichSu.map(x => x.Phien));
      const toAdd = data.filter(x => !existing.has(x.Phien));
      if (toAdd.length > 0) {
        lichSu = [...lichSu, ...toAdd].sort((a,b) => b.Phien - a.Phien).slice(0, 2000);
        console.log(`[📥] Đã load ${toAdd.length} phiên từ LC79 API. Tổng: ${lichSu.length}`);
      }
    }
  } catch(e) { console.error('[❌] Fetch LC79 API lỗi:', e.message); }
}

function connectWebSocket() {
  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch(e){} }
  ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

  ws.on('open', () => {
    console.log('[✅] WebSocket connected');
    INIT_MSGS.forEach((msg, i) => setTimeout(() => { if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }, i*600));
    clearInterval(pingInterval);
    pingInterval = setInterval(() => { if(ws.readyState===WebSocket.OPEN) ws.ping(); }, 10000);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { console.log('[⚠️] Stale - reconnect'); ws.close(); }, 90000);
  });

  ws.on('pong', () => console.log('[📶] Ping OK'));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || typeof data[1] !== 'object') return;
      const { cmd, sid, d1, d2, d3 } = data[1];

      if (cmd === 1005 && data[1].htr) {
        const newData = data[1].htr.map(p => {
          const t = p.d1+p.d2+p.d3;
          return { Phien:p.sid, Xuc_xac_1:p.d1, Xuc_xac_2:p.d2, Xuc_xac_3:p.d3, Tong:t, Ket_qua:t>10?'Tài':'Xỉu' };
        }).reverse();
        const existing = new Set(lichSu.map(x=>x.Phien));
        const toAdd = newData.filter(x=>!existing.has(x.Phien));
        if (toAdd.length > 0) lichSu = [...lichSu, ...toAdd].sort((a,b)=>b.Phien-a.Phien).slice(0, 2000);
        console.log(`[📋] Lịch sử WS: ${lichSu.length} phiên`);
        // Fetch thêm từ LC79 API để có nhiều data hơn
        fetchLichSuLC79().then(() => {
          buildHistoricalPredictions();
          runPrediction();
        });
      }

      if (cmd === 1008 && sid) currentSessionId = sid;

      if (cmd === 1003 && d1 && d2 && d3) {
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => ws.close(), 90000);
        const t = d1+d2+d3;
        const entry = { Phien:currentSessionId, Xuc_xac_1:d1, Xuc_xac_2:d2, Xuc_xac_3:d3, Tong:t, Ket_qua:t>10?'Tài':'Xỉu' };
        lichSu.unshift(entry);
        if (lichSu.length > 2000) lichSu.pop();
        console.log(`[🎲] Phiên ${currentSessionId}: ${d1}-${d2}-${d3}=${t} (${entry.Ket_qua})`);
        currentSessionId = null;
        updateResults();
        setTimeout(runPrediction, 1500);
      }
    } catch(e) { console.error('[❌] WS parse:', e.message); }
  });

  ws.on('close', (code) => {
    console.log(`[🔌] Closed: ${code}`);
    clearInterval(pingInterval); clearTimeout(staleTimer); clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWebSocket, 2500);
  });

  ws.on('error', (e) => { console.error('[❌] WS error:', e.message); try { ws.close(); } catch(_){} });
}

// ===== ALGORITHMS (Ensemble: Cầu Bệt/1-1/2-2 + Math ML + N-Gram) =====
const HISTORY_LENGTH = 500;

function predictBridge(arr) {
  if (arr.length < 4) return null;
  if (arr[0]===arr[1] && arr[1]===arr[2]) return { predict:arr[0], name:'Cầu Bệt' };
  if (arr[0]!==arr[1] && arr[1]!==arr[2] && arr[2]!==arr[3]) return { predict:arr[0]==='Tài'?'Xỉu':'Tài', name:'Cầu 1-1' };
  if (arr[0]===arr[1] && arr[2]===arr[3] && arr[0]!==arr[2]) return { predict:arr[0]==='Tài'?'Xỉu':'Tài', name:'Cầu 2-2' };
  return null;
}

function predictDiceMath(dataObjects) {
  if (dataObjects.length < 10) return { predict:null, accuracy:0 };
  let bestAcc=0, bestRule=null;
  const formulas = [
    d => d[0]+d[1]+d[2],
    d => Math.abs(d[0]-d[1])+d[2],
    d => (d[0]*d[1])+d[2],
    d => d[0]*d[1]*d[2]
  ];
  const rules = [
    val => val%2===0?'Tài':'Xỉu',
    val => val%2!==0?'Tài':'Xỉu',
    val => val>10?'Tài':'Xỉu',
    val => val<=10?'Tài':'Xỉu'
  ];
  for (const f of formulas) for (const r of rules) {
    let correct=0, total=0;
    for (let i=1; i<dataObjects.length; i++) {
      const d = dataObjects[i];
      if (!d.Xuc_xac_1) continue;
      total++;
      if (r(f([d.Xuc_xac_1,d.Xuc_xac_2,d.Xuc_xac_3])) === dataObjects[i-1].Ket_qua) correct++;
    }
    if (total>0 && (correct/total)>bestAcc) { bestAcc=correct/total; bestRule={f,r}; }
  }
  if (bestAcc<0.55 || !bestRule || !dataObjects[0].Xuc_xac_1) return { predict:null, accuracy:bestAcc };
  return {
    predict: bestRule.r(bestRule.f([dataObjects[0].Xuc_xac_1,dataObjects[0].Xuc_xac_2,dataObjects[0].Xuc_xac_3])),
    accuracy: bestAcc, name:'Math ML'
  };
}

function predictNGram(arr) {
  const tai = arr.filter(x=>x==='Tài').length;
  const xiu = arr.filter(x=>x==='Xỉu').length;
  if (tai>xiu) return { predict:'Tài' };
  if (xiu>tai) return { predict:'Xỉu' };
  return { predict:arr[0] };
}

function predictEnsemble(dataObjects, history) {
  if (dataObjects.length < 4) return { predict:'Tài', confidence:50, algo:'Khởi tạo', isReversing:false };
  const txArray = dataObjects.map(x=>x.Ket_qua);
  const votes = { 'Tài':0, 'Xỉu':0 };
  const algos = [];

  const bridge = predictBridge(txArray);
  if (bridge) { votes[bridge.predict]+=1.5; algos.push(bridge.name); }

  const mathML = predictDiceMath(dataObjects);
  if (mathML.predict) { votes[mathML.predict]+=mathML.accuracy*2; algos.push(`Math ML(${(mathML.accuracy*100).toFixed(0)}%)`); }

  const ngram = predictNGram(txArray);
  votes[ngram.predict]+=1.0;
  if (algos.length===0) algos.push('N-Gram');

  let rawPredict = votes['Tài']>votes['Xỉu']?'Tài':'Xỉu';
  const totalW = votes['Tài']+votes['Xỉu'];
  let confidence = totalW>0 ? (votes[rawPredict]/totalW)*100 : 50;

  let isReversing=false, finalPredict=rawPredict;
  if (history && history.length>=10) {
    const wr = history.filter(x=>x.kq==='dung').length/history.length;
    if (wr<0.45) { isReversing=true; finalPredict=rawPredict==='Tài'?'Xỉu':'Tài'; }
  }

  return { predict:finalPredict, confidence:parseFloat(confidence.toFixed(1)), algo:algos.join(' + '), isReversing };
}

// ===== BUILD HISTORICAL PREDICTIONS =====
function buildHistoricalPredictions() {
  if (lichSu.length < HISTORY_LENGTH+1 || predictionHistory.length > 0) return;
  console.log('[📊] Đang tạo lịch sử dự đoán...');
  const built = [];
  const limit = Math.min(lichSu.length - HISTORY_LENGTH, 500);
  for (let i=0; i<limit; i++) {
    const trainData = lichSu.slice(i+1, i+1+HISTORY_LENGTH);
    if (trainData.length < 4) continue;
    const ensemble = predictEnsemble(trainData, built);
    const actual = lichSu[i];
    const ok = ensemble.predict === actual.Ket_qua;
    built.push({
      phien: actual.Phien.toString(),
      du_doan: ensemble.predict,
      ti_le: ensemble.confidence.toFixed(0)+'%',
      thuat_toan: ensemble.algo,
      mo_ta: ensemble.algo,
      kq: ok?'dung':'sai',
      ket_qua: actual.Ket_qua,
      xuc_xac: `${actual.Xuc_xac_1}-${actual.Xuc_xac_2}-${actual.Xuc_xac_3}`,
      tong: actual.Tong.toString(),
      isReversing: ensemble.isReversing,
      timestamp: new Date().toISOString()
    });
  }
  predictionHistory = built.reverse();
  console.log(`[📊] Đã tạo ${predictionHistory.length} phiên lịch sử`);
}

// ===== PREDICTION ENGINE =====
let currentPrediction = null;
let predictionHistory = [];
let lastProcessedPhien = null;

function updateResults() {
  if (lichSu.length===0) return;
  for (const p of predictionHistory) {
    if (p.kq!=='dang_doi') continue;
    const match = lichSu.find(h=>h.Phien.toString()===p.phien);
    if (!match) continue;
    p.ket_qua = match.Ket_qua;
    p.xuc_xac = `${match.Xuc_xac_1}-${match.Xuc_xac_2}-${match.Xuc_xac_3}`;
    p.tong = match.Tong.toString();
    const ok = p.du_doan===match.Ket_qua;
    p.kq = ok?'dung':'sai';
    console.log(`${ok?'✅':'❌'} Phiên #${p.phien}: ${ok?'ĐÚNG':'SAI'} - Dự đoán ${p.du_doan}, thực tế ${match.Ket_qua}`);
  }
}

function runPrediction() {
  if (lichSu.length===0) return;
  const currentPhien = lichSu[0].Phien;
  if (currentPhien===lastProcessedPhien) return;

  const trainData = lichSu.slice(0, HISTORY_LENGTH);
  const ensemble = predictEnsemble(trainData, predictionHistory);
  const nextPhien = currentPhien+1;

  const done = predictionHistory.filter(p=>p.kq!=='dang_doi');
  const correct = done.filter(p=>p.kq==='dung').length;
  const winRate = done.length>0 ? ((correct/done.length)*100).toFixed(1) : '0';

  const newPred = {
    phien: nextPhien.toString(),
    du_doan: ensemble.predict,
    ti_le: ensemble.confidence.toFixed(0)+'%',
    thuat_toan: ensemble.algo,
    mo_ta: ensemble.algo+(ensemble.isReversing?' [ĐẢO CHIỀU]':''),
    isReversing: ensemble.isReversing,
    winRate: winRate+'%',
    kq: 'dang_doi', ket_qua:'---', xuc_xac:'---', tong:'---',
    timestamp: new Date().toISOString()
  };

  currentPrediction = newPred;
  predictionHistory.unshift(newPred);
  if (predictionHistory.length>500) predictionHistory=predictionHistory.slice(0,500);
  lastProcessedPhien = currentPhien;
  console.log(`\n🎲 Dự đoán phiên #${nextPhien}: ${ensemble.predict} (${ensemble.confidence.toFixed(0)}%) - ${ensemble.algo}${ensemble.isReversing?' [ĐẢO CHIỀU]':''}`);
  console.log(`   📊 Winrate: ${winRate}% (${correct}/${done.length})`);
}

// ===== API =====
app.get('/api/prediction', (req,res) => res.json(currentPrediction||{phien:'0',du_doan:'dang_doi',ti_le:'0%',kq:'dang_doi'}));
app.get('/api/prediction-history', (req,res) => res.json(predictionHistory));
app.get('/api/lichsu', (req,res) => res.json(lichSu.slice(0,500)));

app.get('/api/stats', (req,res) => {
  const done = predictionHistory.filter(p=>p.kq!=='dang_doi');
  const correct = done.filter(p=>p.kq==='dung').length;
  res.json({
    predictionStats: {
      total:done.length, correct, wrong:done.length-correct,
      accuracy: done.length>0?((correct/done.length)*100).toFixed(1)+'%':'0%'
    },
    latestSession: lichSu[0]||null,
    currentPrediction
  });
});

app.get('/', (req,res) => res.json({
  message:'🎲 TX Server AI - Ensemble Prediction',
  version:'3.0',
  algorithms:['Cầu Bệt/1-1/2-2','Math ML(500 phiên)','N-Gram','Tự đảo chiều winrate<45%'],
  endpoints:['/api/prediction','/api/prediction-history','/api/lichsu','/api/stats']
}));

// ===== START =====
app.listen(PORT, () => {
  console.log(`\n🎲 TX Server AI chạy tại http://localhost:${PORT}`);
  connectWebSocket();
});
