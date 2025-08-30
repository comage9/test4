const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const multer = require('multer');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const ProductionDatabase = require('./database-json');
const DeliveryDatabase = require('./delivery-database');

// Log __dirname at the very beginning
console.log('__dirname:', __dirname);

process.on('uncaughtException', (err, origin) => {
  console.error(`Caught exception: ${err}\nException origin: ${origin}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.PORT || 5174;

// 파일 변경 감지를 위한 변수들
let excelFileWatcher = null;
let lastModifiedTime = null;
let connectedClients = new Set();

// 데이터베이스 인스턴스
let productionDB = null;
let deliveryDB = null;

app.use(cors());

app.use(bodyParser.json({ limit: '50mb' }));

app.use(express.static(path.join(__dirname), { etag: false, lastModified: true, maxAge: 0 }));

app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname), { etag: false, lastModified: true, maxAge: 0 }));
// Disable cache for dynamic assets to avoid stale JS during updates
app.use((req, res, next) => {
  try {
    const url = (req.url || '').split('?')[0];
    if (url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  } catch (e) {}
  next();
});


// 간단한 파일 로깅 유틸 (패키징 환경에서 종료 원인 추적)
const logFilePath = process.pkg ? path.join(path.dirname(process.execPath), 'server.log') : path.join(__dirname, 'server.log');
function logToFile(...args) {
  try {
    fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  logToFile('uncaughtException', err && (err.stack || err.message));
});
process.on('unhandledRejection', (reason) => {
  logToFile('unhandledRejection', reason && (reason.stack || reason.message || String(reason)));
});

// 이벤트 루프 유지(디버깅용; 서버 시작 실패 시 즉시 종료 방지)
setInterval(() => {}, 60 * 60 * 1000);

// Multer 설정 - 파일 업로드
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadsDir = process.pkg 
            ? path.join(path.dirname(process.execPath), 'uploads')
            : path.join(__dirname, 'uploads');
        
        // uploads 디렉토리가 없으면 생성
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // 타임스탬프를 포함한 파일명으로 저장
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `upload-${timestamp}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Excel, CSV, TXT 파일만 허용
        const allowedTypes = ['.xlsx', '.xls', '.csv', '.txt'];
        const fileExt = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(fileExt)) {
            cb(null, true);
        } else {
            cb(new Error('지원되지 않는 파일 형식입니다. Excel(.xlsx, .xls), CSV(.csv), 텍스트(.txt) 파일만 업로드 가능합니다.'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB 제한
    }
});

// ====================================================================
// 중요: 아래 값을 실제 구글 시트 정보로 반드시 수정해주세요.
// 1. SPREADSHEET_ID: 대상 구글 시트의 ID (URL에서 확인 가능)
// 2. credentials.json: 구글 클라우드 콘솔에서 발급받은 서비스 계정 키 파일
// ====================================================================
const SPREADSHEET_ID = '1Pkp_p2dlpPFUx4k10IhoamT9vze7YXiJdtTCH15y2-E'; // Google 스프레드시트 ID
const SHEET_NAME = '시트4'; // <--- 데이터가 있는 시트 이름을 입력하세요.

// pkg로 빌드된 환경과 로컬 개발 환경 모두에서 credentials.json 경로를 올바르게 찾기 위한 로직
const basePath = process.pkg ? path.dirname(process.execPath) : __dirname;
const credentialsPath = path.join(basePath, 'credentials.json');

async function getAuth() {
    try {
        const { google } = require('googleapis');
        if (!fs.existsSync(credentialsPath)) {
            throw new Error('credentials.json not found');
        }
        const auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath, // 동적으로 설정된 인증키 파일 경로
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const client = await auth.getClient();
        return google.sheets({ version: 'v4', auth: client });
    } catch (e) {
        throw new Error(`Google Sheets auth init failed: ${e.message}`);
    }
}

// 안전한 서버 사이드 프록시 (허용 도메인만 통과)
app.get('/api/proxy', (req, res) => {
    try {
        const target = req.query.url;
        if (!target) {
            return res.status(400).send('Missing url parameter');
        }

        // 허용 호스트 화이트리스트 (하위 도메인 포함 처리)
        const isAllowedHost = (host) => {
            if (!host) return false;
            if (host === 'docs.google.com') return true;
            if (host === 'drive.google.com') return true;
            // *.googleusercontent.com 허용 (스프레드시트가 리디렉션 시 활용)
            return host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
        };

        const fetchWithRedirects = (urlStr, redirectCount = 0) => {
            if (redirectCount > 5) {
                return res.status(508).send('Too many redirects');
            }

            let parsed;
            try {
                parsed = new URL(urlStr);
            } catch (err) {
                console.error('Invalid URL:', urlStr);
                return res.status(400).send('Invalid url');
            }

            if (!isAllowedHost(parsed.hostname)) {
                return res.status(403).send('Host not allowed');
            }

            const client = parsed.protocol === 'https:' ? https : http;
            const options = {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + (parsed.search || ''),
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (proxy)',
                    'Accept': 'text/csv, text/plain, */*'
                }
            };

            const proxReq = client.request(options, (proxRes) => {
                const status = proxRes.statusCode || 200;

                // Redirect handling
                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = proxRes.headers.location;
                    if (location) {
                        const nextUrl = new URL(location, parsed).toString();
                        proxRes.resume(); // discard body
                        return fetchWithRedirects(nextUrl, redirectCount + 1);
                    }
                }

                // Forward status and content type
                res.status(status);
                const contentType = proxRes.headers['content-type'] || 'text/plain; charset=utf-8';
                res.setHeader('Content-Type', contentType);

                proxRes.on('error', (err) => {
                    console.error('Proxy response error:', err.message);
                    if (!res.headersSent) res.status(502);
                    res.end('Proxy response error');
                });
                proxRes.pipe(res);
            });

            proxReq.on('error', (err) => {
                console.error('Proxy fetch error:', err.message);
                if (!res.headersSent) res.status(502).send('Proxy fetch failed');
            });

            proxReq.end();
        };

        fetchWithRedirects(target);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

// [Deprecated] 구글 시트 연동 엔드포인트 (향후 제거)
app.post('/api/data', async (req, res) => {
    try {
        const entries = req.body; // [{hour, quantity}, ...]
        console.log('Received data entries:', entries);

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ message: 'Invalid data format. Expected an array of entries.' });
        }

        const sheets = await getAuth();
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        const day = today.getDate();
        const dateToFind = `${year}. ${month}. ${day}`; // 시트의 날짜 형식에 맞춤: '2025. 7. 25'
        console.log('Looking for date:', dateToFind);

        // 1. 시트에서 날짜 데이터 읽기
        const dateResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:A`,
        });

        const dateRows = dateResponse.data.values || [];
        console.log('Date rows from sheet:', dateRows.map((row, index) => `Row ${index + 1}: "${row[0]}"`));
        
        // 날짜 비교 시 공백과 형식을 정확히 맞춤
        let rowIndex = -1;
        for (let i = 0; i < dateRows.length; i++) {
            if (dateRows[i] && dateRows[i][0]) {
                const cellDate = dateRows[i][0].toString().trim();
                console.log(`Comparing "${cellDate}" with "${dateToFind}"`);
                if (cellDate === dateToFind) {
                    rowIndex = i + 1;
                    console.log(`Found matching date at row ${rowIndex}`);
                    break;
                }
            }
        }
        
        if (rowIndex === -1) {
            rowIndex = 0; // 찾지 못한 경우
        }

        // 2. 오늘 날짜 행이 없으면 새로 추가
        if (rowIndex === 0) {
            console.log('Date not found, adding new row with date:', dateToFind);
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: SHEET_NAME,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[dateToFind]] },
            });
            const newDateResponse = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A:A` });
            rowIndex = (newDateResponse.data.values || []).length;
            console.log('New row created at index:', rowIndex);
        } else {
            console.log('Using existing row at index:', rowIndex);
        }

        // 3. 여러 셀을 한 번에 업데이트하기 위한 요청 데이터 생성
        const data = entries.map(entry => {
            const column = String.fromCharCode('D'.charCodeAt(0) + entry.hour);
            return {
                range: `${SHEET_NAME}!${column}${rowIndex}`,
                values: [[entry.quantity]],
            };
        });

        // 4. Batch Update 실행
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: data,
            },
        });

        res.status(200).json({ message: 'Data updated successfully' });

    } catch (error) {
        console.error('Error updating data:', error);
        res.status(500).json({ message: 'Failed to update data', error: error.message });
    }
});

// === 출고 현황(시간별 누적) API ===
// 최근 N일 조회
app.get('/api/delivery/hourly', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const data = deliveryDB.getRecentDays(days);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 오늘자 시간별 누적 저장 (entries: [{hour, quantity}])
app.post('/api/delivery/hourly', (req, res) => {
  try {
    const entries = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: 'entries array required' });
    }
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const today = new Date();
    const iso = DeliveryDatabase.toIsoDate(today);
    const updated = deliveryDB.upsertHourlyCumulative(iso, entries);
    // SSE 통지 재사용
    notifyClientsOfUpdate();
    res.json({ success: true, date: iso, row: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 전체 데이터 다운로드(JSON)
// JSON 다운로드 비활성화 (요구사항: 제거)
// app.get('/api/delivery/export.json', ...)

// 전체 데이터 업로드(JSON 또는 CSV 파일)
const uploadAny = multer({ storage: storage });
app.post('/api/delivery/import', uploadAny.single('file'), (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    if (!req.file) return res.status(400).json({ success: false, message: 'file field required' });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let result;
    if (ext === '.json') {
      const text = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(text);
      const arr = Array.isArray(json) ? json : (json.delivery_data || []);
      result = deliveryDB.replaceAll(arr);
    } else {
      result = deliveryDB.importFromCsvFile(filePath);
    }
    try { fs.unlinkSync(filePath); } catch {}
    notifyClientsOfUpdate();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 로컬 기본 CSV(일별 출고 수량 보고용 - 시트4.csv)에서 DB 재적재
// 기본 CSV 재적재 비활성화 (요구사항: 제거)
// app.post('/api/delivery/import-default-csv', ...)

// 출고 데이터 엑셀 다운로드
app.get('/api/delivery/export.xlsx', (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const data = deliveryDB.getAll();
    const headers = ['date', 'dayOfWeek', 'total', ...Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))];
    const rows = [headers];
    for (const row of data) {
      const r = [row.date, row.dayOfWeek || '', row.total || 0];
      for (let h = 0; h < 24; h++) {
        r.push(row[`hour_${String(h).padStart(2, '0')}`] || 0);
      }
      rows.push(r);
    }
    const XLSX = require('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'delivery');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="delivery-data.xlsx"');
    res.end(buf);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 출고 데이터 엑셀 업로드
app.post('/api/delivery/import-excel', uploadAny.single('file'), (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    if (!req.file) return res.status(400).json({ success: false, message: 'file field required' });
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      try { fs.unlinkSync(filePath); } catch {}
      return res.status(400).json({ success: false, message: 'xlsx/xls only' });
    }
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!arr || arr.length < 2) throw new Error('empty excel');
    // 포맷: [date, dayOfWeek, total, 00..23]
    const out = [];
    for (let i = 1; i < arr.length; i++) {
      const row = arr[i];
      if (!row || !row[0]) continue;
      const rec = { date: String(row[0]).trim(), dayOfWeek: row[1] || '', total: parseInt(row[2]) || 0 };
      for (let h = 0; h < 24; h++) {
        rec[`hour_${String(h).padStart(2, '0')}`] = parseInt(row[3 + h]) || 0;
      }
      out.push(rec);
    }
    const result = deliveryDB.replaceAll(out);
    try { fs.unlinkSync(filePath); } catch {}
    notifyClientsOfUpdate();
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 전일 출고 총합 조회 API

// 날짜 범위 출고 데이터 조회 API (포함 범위)
app.get('/api/delivery/range', (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ success: false, message: 'start and end required (YYYY-MM-DD)' });
    const s = new Date(String(start));
    const e = new Date(String(end));
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return res.status(400).json({ success: false, message: 'invalid date' });
    const sIso = DeliveryDatabase.toIsoDate(s);
    const eIso = DeliveryDatabase.toIsoDate(e);
    if (sIso > eIso) return res.status(400).json({ success: false, message: 'start must be <= end' });
    const all = deliveryDB.getAll();
    const data = all.filter(r => r.date >= sIso && r.date <= eIso);
    try { console.log('[range] %s ~ %s -> %d days', sIso, eIso, data.length); } catch {}
    res.json({ success: true, start: sIso, end: eIso, count: data.length, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/delivery/previous-total', (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const base = req.query.date ? new Date(String(req.query.date)) : new Date();
    if (isNaN(base.getTime())) return res.status(400).json({ success: false, message: 'invalid date' });
    const prev = new Date(base);
    prev.setDate(prev.getDate() - 1);
    const prevDate = DeliveryDatabase.toIsoDate(prev);
    const row = deliveryDB.getByDate(prevDate);
    const total = row && typeof row.total === 'number' ? row.total : 0;
    res.json({ success: true, prevDate, total, row });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});


// 생산계획 API 엔드포인트 - DB 기반으로 변경
app.get('/api/production-log', async (req, res) => {
    // CORS 헤더 명시적 설정
    res.header('Content-Type', 'application/json');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    try {
        if (!productionDB) {
            return res.status(500).json({ 
                success: false,
                message: '데이터베이스가 초기화되지 않았습니다.' 
            });
        }

        // 모든 데이터 조회
        const allData = productionDB.getAllData();
        
        // 날짜별로 그룹화
        const groupedByDate = {};
        allData.forEach(item => {
            if (!groupedByDate[item.date]) {
                groupedByDate[item.date] = [];
            }
            groupedByDate[item.date].push(item);
        });
        
        // 실제 데이터가 있는 날짜만 추출
        const datesWithData = Object.keys(groupedByDate).filter(date => 
            groupedByDate[date] && groupedByDate[date].length > 0
        );
        
        // 날짜 정렬 (최신순)
        const sortedDates = datesWithData.sort((a, b) => {
            // 날짜 형식: 8/1/25 (월/일/년) -> 2025-08-01로 변환
            const partsA = a.match(/(\d+)\/(\d+)\/(\d+)/);
            const partsB = b.match(/(\d+)\/(\d+)\/(\d+)/);
            
            if (!partsA || !partsB) return 0;
            
            const dateA = new Date('20' + partsA[3] + '-' + partsA[1].padStart(2, '0') + '-' + partsA[2].padStart(2, '0'));
            const dateB = new Date('20' + partsB[3] + '-' + partsB[1].padStart(2, '0') + '-' + partsB[2].padStart(2, '0'));
            
            return dateB - dateA;
        });
        
        const latestDate = sortedDates[0];
        const latestData = groupedByDate[latestDate] || [];
        
        res.json({
            success: true,
            latestDate,
            data: allData,  // 전체 데이터 반환 (다중 날짜 선택을 위해)
            latestData: latestData,  // 최신 날짜 데이터도 별도로 제공
            allDates: sortedDates,
            totalRecords: allData.length
        });
        
    } catch (error) {
        console.error('생산계획 조회 실패:', error);
        res.status(500).json({ 
            success: false,
            message: '생산계획 조회에 실패했습니다.',
            error: error.message 
        });
    }
});

// Server-Sent Events를 위한 엔드포인트
app.get('/api/production-log-events', (req, res) => {
    // SSE 헤더 설정
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no' // nginx buffering 방지
    });

    // 클라이언트를 연결된 클라이언트 목록에 추가
    connectedClients.add(res);
    console.log('SSE 클라이언트 연결됨. 총 연결 수:', connectedClients.size);

    // 연결 유지를 위한 heartbeat
    const heartbeat = setInterval(() => {
        try {
            res.write('data: {"type": "heartbeat"}\n\n');
        } catch (error) {
            clearInterval(heartbeat);
            connectedClients.delete(res);
        }
    }, 30000);

    // 클라이언트 연결 해제 시 정리
    req.on('close', () => {
        connectedClients.delete(res);
        clearInterval(heartbeat);
        console.log('SSE 클라이언트 연결 해제됨. 총 연결 수:', connectedClients.size);
    });

    // 초기 연결 확인 메시지
    try {
        res.write('data: {"type": "connected", "message": "실시간 업데이트 연결됨"}\n\n');
    } catch (error) {
        console.error('SSE 초기 메시지 전송 실패:', error);
    }
});

// 특정 날짜의 생산계획 조회 - DB 기반으로 변경
app.get('/api/production-log/:date', async (req, res) => {
    // CORS 헤더 명시적 설정
    res.header('Content-Type', 'application/json');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    try {
        const targetDate = req.params.date;
        
        if (!productionDB) {
            return res.status(500).json({ 
                success: false,
                message: '데이터베이스가 초기화되지 않았습니다.' 
            });
        }

        // 특정 날짜 데이터 조회
        const dateData = productionDB.getDataByDate(targetDate);
        
        res.json({
            success: true,
            date: targetDate,
            data: dateData,
            totalRecords: dateData.length
        });
        
    } catch (error) {
        console.error('특정 날짜 생산계획 조회 실패:', error);
        res.status(500).json({ 
            success: false,
            message: '생산계획 조회에 실패했습니다.',
            error: error.message 
        });
    }
});

// 생산계획 데이터 삭제 API
app.delete('/api/production-log', (req, res) => {
    // CORS 헤더 명시적 설정
    res.header('Content-Type', 'application/json');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    try {
        if (!productionDB) {
            return res.status(500).json({
                success: false,
                message: '데이터베이스가 초기화되지 않았습니다.'
            });
        }

        const { type, ids, dates, conditions } = req.body;
        let result;

        switch (type) {
            case 'ids':
                // ID 기반 다중 삭제
                if (!ids || !Array.isArray(ids) || ids.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'ID 목록이 필요합니다.'
                    });
                }
                result = productionDB.deleteByIds(ids);
                break;

            case 'dates':
                // 날짜 기반 다중 삭제
                if (!dates || !Array.isArray(dates) || dates.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: '날짜 목록이 필요합니다.'
                    });
                }
                result = productionDB.deleteByDates(dates);
                break;

            case 'all':
                // 전체 삭제
                result = productionDB.deleteAll();
                break;

            case 'condition':
                // 조건부 삭제
                if (!conditions || typeof conditions !== 'object') {
                    return res.status(400).json({
                        success: false,
                        message: '삭제 조건이 필요합니다.'
                    });
                }
                result = productionDB.deleteByCondition(conditions);
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: '유효하지 않은 삭제 타입입니다. (ids, dates, all, condition 중 선택)'
                });
        }

        // 클라이언트들에게 업데이트 알림
        notifyClientsOfUpdate();

        // 삭제 후 통계 정보
        const stats = productionDB.getGroupedByDate();

        res.json({
            success: true,
            message: `${result.deleted}개의 데이터가 삭제되었습니다.`,
            deleted: result.deleted,
            remaining: result.remaining,
            stats: stats
        });

    } catch (error) {
        console.error('데이터 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '데이터 삭제 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 파일 업로드 API - 데이터 비교 및 DB 업데이트 방식으로 변경
app.post('/api/upload-production-file', upload.single('productionFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: '파일이 업로드되지 않았습니다.'
            });
        }

        if (!productionDB) {
            return res.status(500).json({
                success: false,
                message: '데이터베이스가 초기화되지 않았습니다.'
            });
        }

        const uploadedFile = req.file;
        console.log('파일 업로드됨:', uploadedFile.filename);

        // 업로드된 파일을 읽어서 데이터 추출
        let newDataArray = [];
        
        if (path.extname(uploadedFile.filename).toLowerCase() === '.xlsx' || 
            path.extname(uploadedFile.filename).toLowerCase() === '.xls') {
            // Excel 파일 처리
            const workbook = XLSX.readFile(uploadedFile.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                raw: false
            });
            
            newDataArray = jsonData.map((row, index) => {
                if (index === 0 || !row[0]) return null; // 헤더나 빈 행 건너뛰기
                
                // 새로운 필드 매핑: "일자", "Machinenumber", "Moldnumber", "제품명Product name", "Product name", "색상 Color", "롯트번호", "단위", "생산수량", "생산 단위", "비고", "작업예정 수량 (낱개)"
                return {
                    date: row[0] || '',                    // 일자
                    machineNumber: row[1] || '',           // Machinenumber
                    moldNumber: row[2] || '',              // Moldnumber  
                    productName: row[3] || '',             // 제품명Product name
                    productNameEng: row[4] || '',          // Product name
                    color: row[5] || '',                   // 색상 Color
                    lotNumber: row[6] || '',               // 롯트번호
                    unit: row[7] || '',                    // 단위
                    quantity: parseInt(row[8]) || 0,       // 생산수량
                    unitQuantity: parseInt(row[9]) || 0,   // 생산 단위
                    remarks: row[10] || '',                // 비고
                    total: parseInt(row[11]?.toString().replace(/\s/g, '')) || 0  // 작업예정 수량 (낱개)
                };
            }).filter(item => item !== null);
            
        } else if (path.extname(uploadedFile.filename).toLowerCase() === '.csv' || 
                   path.extname(uploadedFile.filename).toLowerCase() === '.txt') {
            // CSV/TXT 파일 처리
            const textData = fs.readFileSync(uploadedFile.path, 'utf8');
            const rows = textData.split('\n').map(row => row.split('\t'));
            
            newDataArray = rows.map((row, index) => {
                if (index === 0 || !row[0]) return null; // 헤더나 빈 행 건너뛰기
                
                return {
                    date: row[0] || '',                    // 일자
                    machineNumber: row[1] || '',           // Machinenumber
                    moldNumber: row[2] || '',              // Moldnumber  
                    productName: row[3] || '',             // 제품명Product name
                    productNameEng: row[4] || '',          // Product name
                    color: row[5] || '',                   // 색상 Color
                    lotNumber: row[6] || '',               // 롯트번호
                    unit: row[7] || '',                    // 단위
                    quantity: parseInt(row[8]) || 0,       // 생산수량
                    unitQuantity: parseInt(row[9]) || 0,   // 생산 단위
                    remarks: row[10] || '',                // 비고
                    total: parseInt(row[11]) || 0          // 작업예정 수량 (낱개)
                };
            }).filter(item => item !== null);
        }

        console.log(`처리된 데이터: ${newDataArray.length}개`);

        // 기존 데이터와 비교하여 변경사항 적용
        const compareResults = productionDB.compareAndUpdateData(newDataArray);

        // 임시 업로드 파일 삭제
        fs.unlinkSync(uploadedFile.path);

        // 클라이언트들에게 업데이트 알림
        notifyClientsOfUpdate();

        // 결과 반환
        res.json({
            success: true,
            message: '파일이 성공적으로 처리되었습니다.',
            filename: uploadedFile.originalname,
            summary: {
                totalProcessed: newDataArray.length,
                added: compareResults.added.length,
                updated: compareResults.updated.length,
                unchanged: compareResults.unchanged.length,
                errors: compareResults.errors.length
            },
            details: compareResults
        });

    } catch (error) {
        console.error('파일 업로드 처리 실패:', error);
        
        // 임시 파일 정리
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.error('임시 파일 정리 실패:', cleanupError);
            }
        }
        
        res.status(500).json({
            success: false,
            message: '파일 업로드 처리 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Excel 파일 변경 감지 설정
function setupFileWatcher() {
    // pkg 빌드 환경에서도 외부 Excel 파일에 접근 가능하도록 수정
    const excelPath = process.pkg 
        ? path.join(path.dirname(process.execPath), 'examples', '생산일지.xlsx')
        : path.join(__dirname, 'examples', '생산일지.xlsx');
    
    if (!fs.existsSync(excelPath)) {
        console.log('생산일지.xlsx 파일이 존재하지 않습니다.');
        return;
    }

    // 초기 수정 시간 기록
    try {
        const stats = fs.statSync(excelPath);
        lastModifiedTime = stats.mtime.getTime();
        console.log('초기 파일 수정 시간:', new Date(lastModifiedTime));
    } catch (error) {
        console.error('파일 정보 읽기 실패:', error);
        return;
    }

    // 기존 watcher가 있다면 정리
    if (excelFileWatcher) {
        excelFileWatcher.close();
    }

    // 파일 변경 감지
    try {
        excelFileWatcher = fs.watch(excelPath, (eventType, filename) => {
            if (eventType === 'change') {
                console.log('Excel 파일 변경 감지:', filename);
                
                // 짧은 지연 후 처리 (파일이 완전히 저장될 때까지 기다림)
                setTimeout(() => {
                    try {
                        const stats = fs.statSync(excelPath);
                        const currentModTime = stats.mtime.getTime();
                        
                        // 실제로 수정 시간이 변경되었는지 확인
                        if (currentModTime !== lastModifiedTime) {
                            lastModifiedTime = currentModTime;
                            console.log('파일 수정 시간 업데이트:', new Date(lastModifiedTime));
                            
                            // 모든 연결된 클라이언트에게 업데이트 알림
                            notifyClientsOfUpdate();
                        }
                    } catch (error) {
                        console.error('파일 정보 읽기 실패:', error);
                    }
                }, 500); // 500ms 지연
            }
        });

        console.log('Excel 파일 변경 감지가 설정되었습니다.');
    } catch (error) {
        console.error('파일 변경 감지 설정 실패:', error);
    }
}

// 클라이언트들에게 업데이트 알림
function notifyClientsOfUpdate() {
    if (connectedClients.size === 0) {
        return;
    }

    const updateMessage = {
        type: 'file_updated',
        message: '생산계획 파일이 업데이트되었습니다.',
        timestamp: new Date().toISOString()
    };

    console.log('클라이언트들에게 파일 업데이트 알림 전송');
    
    // 연결된 모든 클라이언트에게 메시지 전송
    connectedClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify(updateMessage)}\n\n`);
        } catch (error) {
            console.error('클라이언트에게 메시지 전송 실패:', error);
            connectedClients.delete(client);
        }
    });
}

// 서버 시작 함수 (포트 충돌 시 자동 재시도)
function startServer(port, retries = 10) {
  try {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on 0.0.0.0:${port}`);
      console.log(`Try: http://localhost:${port} or http://<server-ip>:${port}`);

      // 데이터베이스 초기화 (최초 1회)
      if (!productionDB) {
        // 패키징된 자산에서 초기 DB 템플릿을 실제 파일로 복사 (없을 때)
        try {
          const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
          const target = path.join(baseDir, 'production.db');
          if (!fs.existsSync(target)) {
            const templatePath = path.join(__dirname, 'production.db'); // asset로 포함됨
            if (fs.existsSync(templatePath)) {
              fs.copyFileSync(templatePath, target);
              console.log('Seed production.db copied to runtime folder');
            }
          }
        } catch (e) {
          console.warn('Seed production.db copy skipped:', e.message);
        }

        productionDB = new ProductionDatabase();
        console.log('Production DB initialized');

        // 비어 있을 경우 Excel로 시드 (스냅샷 자원에서 읽음)
        try {
          const count = (productionDB.getAllData() || []).length;
          if (count === 0) {
            const XLSX = require('xlsx');
            const excelPath = path.join(__dirname, 'examples', '생산일지-full.xlsx');
            if (fs.existsSync(excelPath)) {
              const wb = XLSX.readFile(excelPath);
              const ws = wb.Sheets[wb.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
              const data = rows.map((row, idx) => {
                if (idx === 0 || !row[0]) return null;
                return {
                  date: row[0] || '',
                  line: row[1] || '',
                  sequence: row[2] || '',
                  productName: row[3] || '',
                  productNameEng: row[4] || '',
                  color1: row[5] || '',
                  color2: row[6] || '',
                  unit: row[7] || '',
                  quantity: parseInt(row[8]) || 0,
                  unitQuantity: parseInt(row[9]) || 0,
                  reserved: row[10] || '',
                  total: parseInt((row[11] || '').toString().replace(/\s/g, '')) || 0,
                };
              }).filter(Boolean);
              productionDB.upsertBatchData(data);
              console.log(`Production DB seeded from Excel: ${data.length}`);
            }
          }
        } catch (e) {
          console.warn('Production DB seed skipped:', e.message);
        }
      }
      if (!deliveryDB) {
        // 패키징된 초기 JSON이 있으면 복사 (없으면 자동 생성됨)
        try {
          const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
          const target = path.join(baseDir, 'delivery-data.json');
          if (!fs.existsSync(target)) {
            const templatePath = path.join(__dirname, 'delivery-data.json');
            if (fs.existsSync(templatePath)) {
              fs.copyFileSync(templatePath, target);
              console.log('Seed delivery-data.json copied to runtime folder');
            }
          }
        } catch (e) {
          console.warn('Seed delivery-data copy skipped:', e.message);
        }

        deliveryDB = new DeliveryDatabase();
        console.log('Delivery DB initialized');
        // 초기 CSV에서 출고 데이터 시드(최초 비어있을 때만)
        try {
          const count = (deliveryDB.getAll() || []).length;
          const csvPath = path.join(__dirname, '일별 출고 수량 보고용 - 시트4.csv');
          if (count === 0 && fs.existsSync(csvPath)) {
            const result = deliveryDB.importFromCsvFile(csvPath);
            if (result.imported) console.log(`Delivery CSV imported: ${result.imported} rows`);
          } else {
            console.log(`Skip delivery CSV import on start (existing rows: ${count})`);
          }
        } catch (e) {
          console.log('Delivery CSV import check failed:', e.message);
        }
      }

      // 파일 변경 감지 설정 (생산계획)
      setupFileWatcher();
    });

    server.on('error', (err) => {
      const code = (err && err.code) || 'UNKNOWN';
      console.error('Server failed to start:', code, err && (err.message || err));
      logToFile('Server failed to start', { code, message: err && (err.stack || err.message) });
      if (retries > 0) {
        const nextPort = port + 1;
        console.warn(`Retrying on ${nextPort}... (${retries - 1} left)`);
        setTimeout(() => startServer(nextPort, retries - 1), 600);
      } else {
        console.warn('No retries left. Keeping process alive for inspection.');
      }
    });
  } catch (e) {
    console.error('Unexpected error while starting server:', e);
    logToFile('Unexpected error while starting server', e && (e.stack || e.message));
    // keep process alive for diagnosis; will rely on keep-alive interval
  }
}

startServer(Number(PORT) || 5174);

// 프로세스 종료 시 정리


// DB 경로/상태 정보 (운영 점검용)
app.get('/api/delivery/info', (req, res) => {
  try {
    if (!deliveryDB) return res.status(500).json({ success: false, message: 'Delivery DB not initialized' });
    const fs = require('fs');
    const pathStr = deliveryDB.dbPath;
    let stat = null;
    try { const s = fs.statSync(pathStr); stat = { size: s.size, mtime: s.mtime }; } catch {}
    res.json({ success: true, dbPath: pathStr, stat });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
process.on('SIGINT', () => {
    console.log('서버 종료 중...');
    
    if (excelFileWatcher) {
        excelFileWatcher.close();
        console.log('파일 변경 감지 종료됨');
    }
    
    // 모든 SSE 연결 종료
    connectedClients.forEach(client => {
        try {
            client.end();
        } catch (error) {
            // 이미 종료된 연결은 무시
        }
    });
    
    // 데이터베이스 연결 종료
    if (productionDB) {
        productionDB.close();
        console.log('데이터베이스 연결 종료됨');
    }
    
    process.exit(0);
});
