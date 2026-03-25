const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

let apiResponseData = {
    "Phien": null,
    "Xuc_xac_1": null,
    "Xuc_xac_2": null,
    "Xuc_xac_3": null,
    "Tong": null,
    "Ket_qua": "",
    "id": "@tiendataox"
};

let lichSu = [];
let currentSessionId = null;

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};
const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 10000;
const STALE_TIMEOUT = 90000; // reconnect nếu 90s không có phiên mới

let lastDataTime = Date.now();
let staleTimer = null;

const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnha",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}",
            "signature": "45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

function connectWebSocket() {
    if (ws) {
        ws.removeAllListeners();
        ws.close();
    }

    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
        console.log('[✅] WebSocket connected.');
        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                }
            }, i * 600);
        });

        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        }, PING_INTERVAL);

        // Reset stale timer
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => {
            console.log('[⚠️] Không có dữ liệu 90s — reconnect...');
            if (ws) ws.close();
        }, STALE_TIMEOUT);
    });

    ws.on('pong', () => {
        console.log('[📶] Ping OK.');
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (!Array.isArray(data) || typeof data[1] !== 'object') {
                return;
            }

            const { cmd, sid, d1, d2, d3, gBB } = data[1];

            if (![1011, 10000, 10001, 1008, 100].includes(cmd)) {
                console.log('[MSG] cmd:', cmd, '| data:', JSON.stringify(data[1]));
            }

            if (cmd === 1005 && data[1].htr) {
                lichSu = data[1].htr.map(p => {
                    const tong = p.d1 + p.d2 + p.d3;
                    return {
                        Phien: p.sid,
                        Xuc_xac_1: p.d1,
                        Xuc_xac_2: p.d2,
                        Xuc_xac_3: p.d3,
                        Tong: tong,
                        Ket_qua: tong > 10 ? "Tài" : "Xỉu"
                    };
                }).reverse();
                // Cập nhật phiên mới nhất
                if (lichSu.length > 0) {
                    const last = lichSu[0];
                    apiResponseData = { ...last, id: "@tiendataox" };
                    console.log(`[Lịch sử] Đã load ${lichSu.length} phiên. Mới nhất: Phiên ${last.Phien} - ${last.Ket_qua}`);
                }
            }

            if (cmd === 1008 && sid) {
                currentSessionId = sid;
            }

            if (cmd === 1003 && d1 && d2 && d3) {
                // Reset stale timer khi nhận được data
                lastDataTime = Date.now();
                clearTimeout(staleTimer);
                staleTimer = setTimeout(() => {
                    console.log('[⚠️] Không có dữ liệu 90s — reconnect...');
                    if (ws) ws.close();
                }, STALE_TIMEOUT);

                const total = d1 + d2 + d3;
                const result = (total > 10) ? "Tài" : "Xỉu";

                apiResponseData = {
                    "Phien": currentSessionId,
                    "Xuc_xac_1": d1,
                    "Xuc_xac_2": d2,
                    "Xuc_xac_3": d3,
                    "Tong": total,
                    "Ket_qua": result,
                    "id": "@tiendataox"
                };

                // Thêm vào đầu lịch sử
                lichSu.unshift({ Phien: currentSessionId, Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3, Tong: total, Ket_qua: result });
                if (lichSu.length > 100) lichSu.pop();
                
                console.log(`Phiên ${apiResponseData.Phien}: ${apiResponseData.Tong} (${apiResponseData.Ket_qua})`);
                
                currentSessionId = null;
            }
        } catch (e) {
            console.error('[❌] Lỗi xử lý message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
        clearInterval(pingInterval);
        clearTimeout(staleTimer);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket error:', err.message);
        ws.close();
    });
}

// Thuật toán Thành - bảng nhả cố định (fallback)
const NHA_GOC = {1:5, 2:4, 3:6, 4:2, 5:1, 6:3};

// Học bảng nhả từ dữ liệu thực tế
// Với mỗi xúc xắc X, xem phiên tiếp theo thường ra số mấy nhiều nhất
function hocBangNha(lichSuData) {
    // freq[x][y] = số lần xúc xắc x ở phiên trước → phiên sau có xúc xắc y
    const freq = {};
    for (let i = 1; i <= 6; i++) { freq[i] = {1:0,2:0,3:0,4:0,5:0,6:0}; }

    for (let i = 0; i < lichSuData.length - 1; i++) {
        const cur = lichSuData[i];
        const next = lichSuData[i+1];
        // Học từ từng vị trí xúc xắc
        [cur.Xuc_xac_1, cur.Xuc_xac_2, cur.Xuc_xac_3].forEach((v, pos) => {
            const nextVals = [next.Xuc_xac_1, next.Xuc_xac_2, next.Xuc_xac_3];
            nextVals.forEach(nv => { if(freq[v]) freq[v][nv]++; });
        });
    }

    // Tạo bảng nhả: x → số xuất hiện nhiều nhất sau x
    const bangNha = {};
    for (let x = 1; x <= 6; x++) {
        let maxCount = 0, bestY = NHA_GOC[x];
        for (let y = 1; y <= 6; y++) {
            if (freq[x][y] > maxCount) { maxCount = freq[x][y]; bestY = y; }
        }
        bangNha[x] = bestY;
    }
    return bangNha;
}

function duDoanAdaptive(d1, d2, d3, bangNha) {
    const count = {};
    function nha(v) {
        count[v] = (count[v]||0)+1;
        let r = bangNha[v] - (count[v]-1);
        return r < 1 ? 1 : r;
    }
    const r3=nha(d3), r2=nha(d2), r1=nha(d1);
    const tong = r1+r2+r3;
    return { d1:r1, d2:r2, d3:r3, tong, kq: tong>10?'Tài':'Xỉu' };
}

function duDoanThanh(d1, d2, d3) {
    const count = {};
    function nha(v) { count[v] = (count[v]||0)+1; let r = NHA_GOC[v]-(count[v]-1); return r<1?1:r; }
    const r3=nha(d3), r2=nha(d2), r1=nha(d1);
    const tong = r1+r2+r3;
    return { d1:r1, d2:r2, d3:r3, tong, kq: tong>10?'Tài':'Xỉu' };
}

app.get('/api/dudoan', (req, res) => {
    if (lichSu.length < 2) return res.json({ error: 'Chưa đủ dữ liệu' });

    const current = lichSu[0];

    // Học bảng nhả từ 100 phiên gần nhất
    const bangNha = hocBangNha(lichSu.slice(0, 100));
    const dd = duDoanAdaptive(current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3, bangNha);
    const ddGoc = duDoanThanh(current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3);

    const historyTemp = [];
    for (let i = Math.min(99, lichSu.length - 2); i >= 0; i--) {
        const thuc = lichSu[i];
        const truoc = lichSu[i+1];
        // Học bảng nhả từ các phiên trước đó
        const bangNhaLS = hocBangNha(lichSu.slice(i+1, Math.min(i+101, lichSu.length)));
        const pred = duDoanAdaptive(truoc.Xuc_xac_1, truoc.Xuc_xac_2, truoc.Xuc_xac_3, bangNhaLS);
        historyTemp.push({
            Phien: thuc.Phien,
            Du_doan: pred.kq,
            Ket_qua: thuc.Ket_qua,
            Dung_sai: pred.kq === thuc.Ket_qua ? 'Đúng' : 'Sai',
            Tong_du_doan: pred.tong
        });
    }
    const history = historyTemp.reverse();

    let saiLienTiep = 0;
    for (let i = 0; i < history.length; i++) {
        if (history[i].Dung_sai === 'Sai') saiLienTiep++;
        else break;
    }

    const dungCount = history.filter(h => h.Dung_sai === 'Đúng').length;

    res.json({
        Phien_tiep_theo: current.Phien + 1,
        Du_doan: dd.kq,
        Du_doan_goc: ddGoc.kq,
        Bang_nha: bangNha,
        Xuc_xac_du_doan: { d1: dd.d1, d2: dd.d2, d3: dd.d3 },
        Tong_du_doan: dd.tong,
        Sai_lien_tiep: saiLienTiep,
        Dieu_chinh: dd.kq !== ddGoc.kq,
        Ty_le_dung: `${dungCount}/${history.length} (${Math.round(dungCount/history.length*100)}%)`,
        Lich_su: history,
        id: '@tiendataox'
    });
});

app.get('/api/ditmemaysun', (req, res) => {
    res.json(apiResponseData);
});

app.get('/api/lichsu', (req, res) => {
    res.json(lichSu);
});

app.get('/', (req, res) => {
    res.json(apiResponseData);
});

app.listen(PORT, () => {
    console.log(`[🌐] Server is running at http://localhost:${PORT}`);
    connectWebSocket();
});