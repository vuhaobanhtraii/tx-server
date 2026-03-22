const https = require('https');
const http = require('http');

const SOURCE_API = 'https://markers-amenities-vertex-gratuit.trycloudflare.com/api/tx';
const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200;
const FETCH_INTERVAL = 3000;

let history = []; // newest first
let lastPhien = null;
let lastData = null;

function fetchSource() {
  const url = new URL(SOURCE_API);
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.get(SOURCE_API, { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        lastData = data;
        const phien = data.phien;
        const ket_qua = data.ket_qua;
        if (phien !== lastPhien && ket_qua && (ket_qua === 'Tài' || ket_qua === 'Xỉu')) {
          history.unshift({
            phien,
            ket_qua,
            tong: data.tong,
            xuc_xac_1: data.xuc_xac_1,
            xuc_xac_2: data.xuc_xac_2,
            xuc_xac_3: data.xuc_xac_3,
            thoi_gian: data.thoi_gian
          });
          if (history.length > MAX_HISTORY) history.pop();
          lastPhien = phien;
          console.log(`[${new Date().toLocaleTimeString()}] Phiên ${phien}: ${ket_qua} (tổng ${data.tong})`);
        }
      } catch(e) {
        console.error('Parse error:', e.message);
      }
    });
  });
  req.on('error', e => console.error('Fetch error:', e.message));
  req.on('timeout', () => { req.destroy(); console.error('Fetch timeout'); });
}

setInterval(fetchSource, FETCH_INTERVAL);
fetchSource();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const path = req.url.split('?')[0];

  if (path === '/api/history') {
    res.writeHead(200);
    res.end(JSON.stringify({
      history,
      current: lastData,
      count: history.length,
      updated: new Date().toISOString()
    }));
  } else if (path === '/api/current') {
    res.writeHead(200);
    res.end(JSON.stringify(lastData || {}));
  } else if (path === '/health' || path === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', history_count: history.length, last_phien: lastPhien }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
