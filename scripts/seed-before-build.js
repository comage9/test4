const fs = require('fs');
const path = require('path');

function log(msg) { console.log(`[seed] ${msg}`); }

// Seed Production SQLite DB from Excel
function seedProductionDB() {
  const dbPath = path.join(__dirname, '..', 'production.db');
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      log(`Removed existing production.db`);
    }
  } catch (e) {
    log(`Skip removing production.db: ${e.message}`);
  }

  let ProductionDatabase, XLSX;
  try {
    ProductionDatabase = require('../database');
    XLSX = require('xlsx');
  } catch (e) {
    log(`Skip production DB seed (native module not available): ${e.message}`);
    return; // in CI/WSL cross-build environments, better-sqlite3 may not be loadable
  }
  const excelPath = path.join(__dirname, '..', 'examples', '생산일지-full.xlsx');

  const db = new ProductionDatabase();
  try {
    if (!fs.existsSync(excelPath)) {
      log('Excel not found, skipping production DB seed');
      return;
    }
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
    db.upsertBatchData(data);
    log(`Seeded production.db with ${data.length} rows from Excel`);
  } catch (e) {
    log(`Production DB seed failed: ${e.message}`);
  } finally {
    db.close();
  }
}

// Seed Delivery JSON DB from CSV
function seedDeliveryJSON() {
  const jsonPath = path.join(__dirname, '..', 'delivery-data.json');
  try {
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
      log(`Removed existing delivery-data.json`);
    }
  } catch (e) {
    log(`Skip removing delivery-data.json: ${e.message}`);
  }

  const DeliveryDatabase = require('../delivery-database');
  const csvPath = path.join(__dirname, '..', '일별 출고 수량 보고용 - 시트4.csv');
  const db = new DeliveryDatabase();
  try {
    const result = db.importFromCsvFile(csvPath);
    log(`Seeded delivery-data.json from CSV: imported=${result.imported || 0}`);
  } catch (e) {
    log(`Delivery JSON seed failed: ${e.message}`);
  }
}

(function main() {
  log('Seeding databases before build...');
  try { seedProductionDB(); } catch (e) { log(`Production seed skipped due to error: ${e.message}`); }
  try { seedDeliveryJSON(); } catch (e) { log(`Delivery seed skipped due to error: ${e.message}`); }
  log('Seeding complete.');
})();

