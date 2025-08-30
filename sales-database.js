const fs = require('fs');
const path = require('path');

class SalesDatabase {
  constructor() {
    const envPath = process.env.SALES_DB_PATH && String(process.env.SALES_DB_PATH).trim();
    if (envPath) {
      this.dbPath = path.resolve(envPath);
      try { fs.mkdirSync(path.dirname(this.dbPath), { recursive: true }); } catch {}
    } else {
      this.dbPath = process.pkg
        ? path.join(path.dirname(process.execPath), 'sales-data.json')
        : path.join(__dirname, 'sales-data.json');
    }
    this._init();
  }

  _init() {
    if (!fs.existsSync(this.dbPath)) {
      const initial = { sales: [], metadata: { created_at: new Date().toISOString(), version: '1.0.0' } };
      fs.writeFileSync(this.dbPath, JSON.stringify(initial, null, 2));
    }
  }

  _read() {
    try { return JSON.parse(fs.readFileSync(this.dbPath, 'utf8')); }
    catch { return { sales: [], metadata: {} }; }
  }

  _write(data) {
    data.metadata = data.metadata || {};
    data.metadata.updated_at = new Date().toISOString();
    const tmp = this.dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    try {
      const bak = this.dbPath + '.bak';
      if (fs.existsSync(this.dbPath)) { try { fs.copyFileSync(this.dbPath, bak); } catch {} }
    } catch {}
    fs.renameSync(tmp, this.dbPath);
  }

  static toIsoDateStr(s) {
    // supports YYYY-MM-DD or other common separators
    const t = String(s || '').trim();
    const m = t.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!m) return null;
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }

  static parseNumber(s) {
    const n = parseFloat(String(s || '').replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  replaceAll(rows) {
    if (!Array.isArray(rows)) throw new Error('rows array required');
    const db = this._read();
    // normalize rows
    db.sales = rows.map(r => ({
      id: r.id || '',
      date: r.date,
      barcode: r.barcode || '',
      box_qty: Number.isFinite(r.box_qty) ? r.box_qty : 0,
      ea_qty: Number.isFinite(r.ea_qty) ? r.ea_qty : 0,
      item: r.item || '',
      category: r.category || '',
      seq: r.seq || '',
      unit_count: r.unit_count || '',
      amount: Number.isFinite(r.amount) ? r.amount : 0,
      note: r.note || ''
    }));
    db.sales.sort((a, b) => a.date.localeCompare(b.date));
    this._write(db);
    return { count: db.sales.length };
  }

  importFromCsvFile(csvPath) {
    if (!csvPath || !fs.existsSync(csvPath)) return { imported: 0 };
    const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return { imported: 0 };
    const headers = lines[0].split(',').map(h => h.trim());
    const idx = (name) => headers.findIndex(h => h === name);
    const col = {
      id: idx('id'),
      date: idx('일자'),
      barcode: idx('바코드'),
      box: idx('수량(박스)'),
      ea: idx('수량(낱개)'),
      item: idx('품목'),
      category: idx('분류'),
      seq: idx('순번'),
      unit: idx('단수'),
      amount: idx('판매금액'),
      note: idx('비고')
    };
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = this._splitCsvLine(lines[i]);
      if (!parts || parts.length === 0) continue;
      const date = SalesDatabase.toIsoDateStr(parts[col.date]);
      if (!date) continue;
      rows.push({
        id: (parts[col.id] || '').trim(),
        date,
        barcode: (parts[col.barcode] || '').trim(),
        box_qty: SalesDatabase.parseNumber(parts[col.box]),
        ea_qty: SalesDatabase.parseNumber(parts[col.ea]),
        item: (parts[col.item] || '').trim(),
        category: (parts[col.category] || '').trim(),
        seq: (parts[col.seq] || '').trim(),
        unit_count: (parts[col.unit] || '').trim(),
        amount: SalesDatabase.parseNumber(parts[col.amount]),
        note: (parts[col.note] || '').trim(),
      });
    }
    return this.replaceAll(rows);
  }

  _splitCsvLine(line) {
    const res = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]; const nx = line[i + 1];
      if (ch === '"') { if (q && nx === '"') { cur += '"'; i++; } else { q = !q; } }
      else if (!q && ch === ',') { res.push(cur); cur = ''; }
      else { cur += ch; }
    }
    res.push(cur);
    return res.map(s => s.trim());
  }

  getRange(startIso, endIso) {
    const db = this._read();
    const s = String(startIso); const e = String(endIso);
    return db.sales.filter(r => r.date >= s && r.date <= e).sort((a,b)=> a.date.localeCompare(b.date));
  }

  getDailyTotals(startIso, endIso) {
    const rows = this.getRange(startIso, endIso);
    const map = new Map();
    for (const r of rows) {
      const o = map.get(r.date) || { date: r.date, ea_qty: 0, box_qty: 0, amount: 0 };
      o.ea_qty += r.ea_qty || 0;
      o.box_qty += r.box_qty || 0;
      o.amount += r.amount || 0;
      map.set(r.date, o);
    }
    return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
  }

  getCategoryTotals(startIso, endIso) {
    const rows = this.getRange(startIso, endIso);
    const agg = {};
    for (const r of rows) {
      const k = r.category || '-';
      if (!agg[k]) agg[k] = { category: k, amount: 0, ea_qty: 0, box_qty: 0 };
      agg[k].amount += r.amount || 0;
      agg[k].ea_qty += r.ea_qty || 0;
      agg[k].box_qty += r.box_qty || 0;
    }
    return Object.values(agg).sort((a,b)=> b.amount - a.amount);
  }

  // 일자+분류 기준 합계(박스/낱개/금액)
  getDailyCategoryTotals(startIso, endIso) {
    const rows = this.getRange(startIso, endIso);
    const map = new Map(); // key: `${date}__${category}`
    for (const r of rows) {
      const date = r.date;
      const cat = r.category || '-';
      const key = `${date}__${cat}`;
      const cur = map.get(key) || { date, category: cat, box_qty: 0, ea_qty: 0, amount: 0 };
      cur.box_qty += r.box_qty || 0;
      cur.ea_qty += r.ea_qty || 0;
      cur.amount += r.amount || 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date) || a.category.localeCompare(b.category));
  }

  // 특정 일자+분류의 품목별 합계(박스/낱개/금액)
  getItemsByDateCategoryTotals(dateIso, category) {
    const rows = this.getRange(dateIso, dateIso);
    const targetCat = category || '-';
    const map = new Map();
    for (const r of rows) {
      const cat = r.category || '-';
      if (cat !== targetCat) continue;
      const key = r.item || '-';
      const cur = map.get(key) || { item: key, box_qty: 0, ea_qty: 0, amount: 0 };
      cur.box_qty += r.box_qty || 0;
      cur.ea_qty += r.ea_qty || 0;
      cur.amount += r.amount || 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a,b)=> b.box_qty - a.box_qty || a.item.localeCompare(b.item));
  }
}

module.exports = SalesDatabase;
