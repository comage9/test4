const Database = require('better-sqlite3');
const path = require('path');

class ProductionDatabase {
    constructor() {
        // pkg 빌드 환경에서도 외부 DB 파일에 접근 가능하도록 수정
        const dbPath = process.pkg 
            ? path.join(path.dirname(process.execPath), 'production.db')
            : path.join(__dirname, 'production.db');
        
        try {
            this.db = new Database(dbPath);
            console.log('SQLite 데이터베이스 연결 성공:', dbPath);
            this.initializeTables();
        } catch (err) {
            console.error('데이터베이스 연결 실패:', err.message);
            throw err;
        }
    }

    initializeTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS production_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                line TEXT,
                sequence TEXT,
                productName TEXT,
                productNameEng TEXT,
                color1 TEXT,
                color2 TEXT,
                unit TEXT,
                quantity INTEGER DEFAULT 0,
                unitQuantity INTEGER DEFAULT 0,
                reserved TEXT,
                total INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date, line, sequence, productName, color1, color2)
            )
        `;

        try {
            this.db.exec(createTableSQL);
            console.log('production_data 테이블 준비 완료');
        } catch (err) {
            console.error('테이블 생성 실패:', err.message);
            throw err;
        }
    }

    // 모든 데이터 조회
    getAllData() {
        const sql = `
            SELECT * FROM production_data 
            ORDER BY date DESC, line, sequence
        `;
        
        try {
            return this.db.prepare(sql).all();
        } catch (err) {
            console.error('데이터 조회 실패:', err.message);
            throw err;
        }
    }

    // 특정 날짜 데이터 조회
    getDataByDate(date) {
        const sql = `
            SELECT * FROM production_data 
            WHERE date = ? 
            ORDER BY line, sequence
        `;
        
        try {
            return this.db.prepare(sql).all(date);
        } catch (err) {
            console.error('날짜별 데이터 조회 실패:', err.message);
            throw err;
        }
    }

    // 날짜별 그룹화된 데이터 조회
    getGroupedByDate() {
        const sql = `
            SELECT date, COUNT(*) as count, SUM(total) as totalQuantity
            FROM production_data 
            GROUP BY date 
            ORDER BY date DESC
        `;
        
        try {
            return this.db.prepare(sql).all();
        } catch (err) {
            console.error('그룹별 데이터 조회 실패:', err.message);
            throw err;
        }
    }

    // 데이터 삽입 또는 업데이트 (UPSERT)
    upsertData(data) {
        const sql = `
            INSERT OR REPLACE INTO production_data 
            (date, line, sequence, productName, productNameEng, color1, color2, unit, quantity, unitQuantity, reserved, total, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        const params = [
            data.date, data.line, data.sequence, data.productName, data.productNameEng,
            data.color1, data.color2, data.unit, data.quantity, data.unitQuantity,
            data.reserved, data.total
        ];
        
        try {
            const result = this.db.prepare(sql).run(params);
            return {
                id: result.lastInsertRowid,
                changes: result.changes
            };
        } catch (err) {
            console.error('데이터 삽입/업데이트 실패:', err.message);
            throw err;
        }
    }

    // 배치 데이터 삽입/업데이트
    upsertBatchData(dataArray) {
        const results = {
            inserted: 0,
            updated: 0,
            errors: []
        };

        for (const data of dataArray) {
            try {
                const result = this.upsertData(data);
                if (result.changes > 0) {
                    results.updated++;
                } else {
                    results.inserted++;
                }
            } catch (error) {
                results.errors.push({
                    data: data,
                    error: error.message
                });
            }
        }

        return results;
    }

    // 데이터 비교 및 변경사항 감지
    compareAndUpdateData(newDataArray) {
        const results = {
            added: [],
            updated: [],
            unchanged: [],
            errors: []
        };

        try {
            // 기존 데이터 조회
            const existingData = this.getAllData();
            const existingMap = new Map();
            
            // 기존 데이터를 Map으로 변환 (고유키: date_line_sequence_productName_color1_color2)
            existingData.forEach(item => {
                const key = `${item.date}_${item.line}_${item.sequence}_${item.productName}_${item.color1}_${item.color2}`;
                existingMap.set(key, item);
            });

            // 새 데이터와 비교
            for (const newItem of newDataArray) {
                const key = `${newItem.date}_${newItem.line}_${newItem.sequence}_${newItem.productName}_${newItem.color1}_${newItem.color2}`;
                const existingItem = existingMap.get(key);

                if (!existingItem) {
                    // 새로운 데이터
                    try {
                        this.upsertData(newItem);
                        results.added.push(newItem);
                    } catch (error) {
                        results.errors.push({ data: newItem, error: error.message });
                    }
                } else {
                    // 기존 데이터와 비교하여 변경사항 확인
                    const hasChanges = this.hasDataChanges(existingItem, newItem);
                    
                    if (hasChanges) {
                        try {
                            this.upsertData(newItem);
                            results.updated.push({
                                old: existingItem,
                                new: newItem
                            });
                        } catch (error) {
                            results.errors.push({ data: newItem, error: error.message });
                        }
                    } else {
                        results.unchanged.push(newItem);
                    }
                }
            }

            return results;
        } catch (error) {
            throw new Error(`데이터 비교 및 업데이트 실패: ${error.message}`);
        }
    }

    // 데이터 변경사항 확인
    hasDataChanges(oldData, newData) {
        const compareFields = ['unit', 'quantity', 'unitQuantity', 'reserved', 'total'];
        
        for (const field of compareFields) {
            if (oldData[field] !== newData[field]) {
                return true;
            }
        }
        
        return false;
    }

    // 데이터베이스 연결 종료
    close() {
        try {
            this.db.close();
            console.log('데이터베이스 연결 종료');
        } catch (err) {
            console.error('데이터베이스 연결 종료 실패:', err.message);
        }
    }
}

module.exports = ProductionDatabase;