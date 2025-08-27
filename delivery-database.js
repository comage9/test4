const fs = require('fs');
const path = require('path');

// 간단한 JSON 기반 출고 현황 DB
class DeliveryDatabase {
  constructor() {
    this.dbPath = process.pkg
      ? path.join(path.dirname(process.execPath), 'delivery-data.json')
      : path.join(__dirname, 'delivery-data.json');

    this._init();
  }

  _init() {
    if (!fs.existsSync(this.dbPath)) {
      const initial = { delivery_data: [], metadata: { created_at: new Date().toISOString(), version: '1.0.0' } };
      fs.writeFileSync(this.dbPath, JSON.stringify(initial, null, 2));
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch (e) {
      return { delivery_data: [], metadata: {} };
    }
  }

  _write(data) {
    data.metadata = data.metadata || {};
    data.metadata.updated_at = new Date().toISOString();
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  // YYYY-MM-DD 문자열 반환
  static toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  static getKoreanDayOfWeek(d) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[d.getDay()];
  }

  // 최근 N일 조회 (오래된 순 → 최신 순)
  getRecentDays(days = 14) {
    const data = this._read().delivery_data;
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const slice = sorted.slice(-days);
    return slice;
  }

  // 전체 데이터 조회 (날짜 오름차순)
  getAll() {
    const data = this._read().delivery_data;
    return [...data].sort((a, b) => a.date.localeCompare(b.date));
  }

  // 특정 날짜(YYYY-MM-DD) 레코드 조회 (없으면 null)
  getByDate(date) {
    const data = this._read().delivery_data;
    return data.find(r => r.date === date) || null;
  }

  // 특정 날짜(YYYY-MM-DD) 레코드 upsert
  upsert(date, updates) {
    const db = this._read();
    let row = db.delivery_data.find(r => r.date === date);
    if (!row) {
      row = this._createEmptyDay(date);
      db.delivery_data.push(row);
    }
    Object.assign(row, updates);
    // 총계를 최신 시간 실데이터/예측 포함 마지막 값으로 보정
    const hours = Array.from({ length: 24 }, (_, i) => `hour_${String(i).padStart(2, '0')}`);
    for (let i = 23; i >= 0; i--) {
      const v = parseInt(row[hours[i]]) || 0;
      if (v > 0) { row.total = v; break; }
    }
    this._write(db);
    return row;
  }

  // 시간별 누적 입력 반영: entries = [{hour, quantity}]
  upsertHourlyCumulative(date, entries) {
    const updates = {};
    for (const { hour, quantity } of entries) {
      const h = Number(hour);
      if (Number.isInteger(h) && h >= 0 && h <= 23) {
        updates[`hour_${String(h).padStart(2, '0')}`] = parseInt(quantity) || 0;
      }
    }
    return this.upsert(date, updates);
  }

  // CSV 파일에서 초기 데이터 로드 (구글 시트 중단 대비)
  importFromCsvFile(csvPath) {
    if (!csvPath || !fs.existsSync(csvPath)) return { imported: 0 };
    const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { imported: 0 };

    // 구분자 추정
    const sep = (h => {
      const cnt = { ',': (h.match(/,/g) || []).length, ';': (h.match(/;/g) || []).length, '\t': (h.match(/\t/g) || []).length };
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      return best && best[1] > 0 ? (best[0] === '\\t' ? '\t' : best[0]) : ',';
    })(lines[0]);

    const parseLine = (line, delim) => {
      const res = []; let cur = ''; let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i], nx = line[i + 1];
        if (ch === '"') { if (q && nx === '"') { cur += '"'; i++; } else { q = !q; } }
        else if (!q && ((delim === '\t' && ch === '\t') || (delim !== '\t' && ch === delim))) { res.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      res.push(cur.trim());
      return res;
    };

    const headers = parseLine(lines[0], sep);
    let imported = 0;
    const db = this._read();

    for (let i = 1; i < lines.length; i++) {
      const vals = parseLine(lines[i], sep);
      if (vals.length < 3) continue;
      const dateStr = this._normalizeDate(vals[0]);
      if (!dateStr) continue;
      const dayOfWeek = vals[1] || '';
      const row = this._createEmptyDay(dateStr, dayOfWeek);
      row.total = this._parseNumber(vals[2]);
      for (let h = 0; h < 24; h++) {
        const idx = 3 + h;
        if (idx < vals.length) {
          row[`hour_${String(h).padStart(2, '0')}`] = this._parseNumber(vals[idx]);
        }
      }
      // upsert by date (replace existing)
      const idxExisting = db.delivery_data.findIndex(r => r.date === dateStr);
      if (idxExisting >= 0) db.delivery_data[idxExisting] = row; else db.delivery_data.push(row);
      imported++;
    }

    db.delivery_data.sort((a, b) => a.date.localeCompare(b.date));
    this._write(db);
    return { imported };
  }

  // JSON 배열로 전체 교체(안전하게 형식 검증 최소화)
  replaceAll(array) {
    if (!Array.isArray(array)) throw new Error('array required');
    const db = this._read();
    db.delivery_data = array.map(row => {
      const o = this._createEmptyDay(row.date, row.dayOfWeek);
      o.total = this._parseNumber(row.total);
      for (let h = 0; h < 24; h++) {
        const key = `hour_${String(h).padStart(2, '0')}`;
        o[key] = this._parseNumber(row[key]);
      }
      return o;
    }).sort((a, b) => a.date.localeCompare(b.date));
    this._write(db);
    return { count: db.delivery_data.length };
  }

  _parseNumber(val) { const n = parseInt(String(val).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; }
  _normalizeDate(s) {
    if (!s) return null;
    const t = String(s).trim().replace(/\s+/g, '');
    let m = t.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})\.?$/);
    if (m) { const [_, y, mo, d] = m; return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
    m = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (m) { let [_, mo, d, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`; }
    return null;
  }

  _createEmptyDay(date, dayOfWeek) {
    const dow = dayOfWeek || DeliveryDatabase.getKoreanDayOfWeek(new Date(date));
    const base = { date, dayOfWeek: dow, total: 0 };
    for (let h = 0; h < 24; h++) base[`hour_${String(h).padStart(2, '0')}`] = 0;
    return base;
  }
}

module.exports = DeliveryDatabase;
