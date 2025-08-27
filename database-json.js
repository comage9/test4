const fs = require('fs');
const path = require('path');

class ProductionDatabase {
    constructor() {
        // pkg 빌드 환경에서도 외부 DB 파일에 접근 가능하도록 수정
        this.dbPath = process.pkg 
            ? path.join(path.dirname(process.execPath), 'production-data.json')
            : path.join(__dirname, 'production-data.json');
        
        try {
            this.initializeDatabase();
            console.log('JSON 데이터베이스 연결 성공:', this.dbPath);
        } catch (err) {
            console.error('데이터베이스 연결 실패:', err.message);
            throw err;
        }
    }

    initializeDatabase() {
        if (!fs.existsSync(this.dbPath)) {
            // 초기 데이터베이스 파일 생성
            const initialData = {
                production_data: [],
                metadata: {
                    created_at: new Date().toISOString(),
                    version: "1.0.0"
                }
            };
            fs.writeFileSync(this.dbPath, JSON.stringify(initialData, null, 2));
            console.log('새로운 JSON 데이터베이스 파일 생성됨');
        }
    }

    // 데이터 읽기
    _readData() {
        try {
            const rawData = fs.readFileSync(this.dbPath, 'utf8');
            return JSON.parse(rawData);
        } catch (err) {
            console.error('데이터 읽기 실패:', err.message);
            return { production_data: [], metadata: {} };
        }
    }

    // 데이터 쓰기
    _writeData(data) {
        try {
            data.metadata = data.metadata || {};
            data.metadata.updated_at = new Date().toISOString();
            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('데이터 쓰기 실패:', err.message);
            throw err;
        }
    }

    // 모든 데이터 조회
    getAllData() {
        const data = this._readData();
        return data.production_data.sort((a, b) => {
            // null/undefined 값 안전 처리
            const dateA = a.date || '';
            const dateB = b.date || '';
            const machineA = a.machineNumber || '';
            const machineB = b.machineNumber || '';
            const moldA = a.moldNumber || '';
            const moldB = b.moldNumber || '';
            
            // 날짜 내림차순, 그 다음 기계번호, 몰드번호 순
            if (dateA !== dateB) return dateB.localeCompare(dateA);
            if (machineA !== machineB) return machineA.localeCompare(machineB);
            return moldA.localeCompare(moldB);
        });
    }

    // 특정 날짜 데이터 조회
    getDataByDate(date) {
        const data = this._readData();
        return data.production_data
            .filter(item => item.date === date)
            .sort((a, b) => {
                // null/undefined 값 안전 처리
                const machineA = a.machineNumber || '';
                const machineB = b.machineNumber || '';
                const moldA = a.moldNumber || '';
                const moldB = b.moldNumber || '';
                
                if (machineA !== machineB) return machineA.localeCompare(machineB);
                return moldA.localeCompare(moldB);
            });
    }

    // 날짜별 그룹화된 데이터 조회
    getGroupedByDate() {
        const data = this._readData();
        const grouped = {};
        
        data.production_data.forEach(item => {
            if (!grouped[item.date]) {
                grouped[item.date] = {
                    date: item.date,
                    count: 0,
                    totalQuantity: 0
                };
            }
            grouped[item.date].count++;
            grouped[item.date].totalQuantity += item.total || 0;
        });

        return Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date));
    }

    // 데이터 삽입 또는 업데이트 (UPSERT)
    upsertData(newItem) {
        const data = this._readData();
        const key = `${newItem.date}_${newItem.machineNumber}_${newItem.moldNumber}_${newItem.productName}_${newItem.color}_${newItem.lotNumber}`;
        
        // 기존 데이터에서 같은 키를 가진 항목 찾기
        const existingIndex = data.production_data.findIndex(item => {
            const existingKey = `${item.date}_${item.machineNumber}_${item.moldNumber}_${item.productName}_${item.color}_${item.lotNumber}`;
            return existingKey === key;
        });

        if (existingIndex !== -1) {
            // 업데이트
            data.production_data[existingIndex] = {
                ...newItem,
                id: data.production_data[existingIndex].id,
                created_at: data.production_data[existingIndex].created_at,
                updated_at: new Date().toISOString()
            };
        } else {
            // 새로 추가
            const newId = Math.max(0, ...data.production_data.map(item => item.id || 0)) + 1;
            data.production_data.push({
                ...newItem,
                id: newId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }

        this._writeData(data);
        return {
            id: existingIndex !== -1 ? data.production_data[existingIndex].id : data.production_data[data.production_data.length - 1].id,
            changes: 1
        };
    }

    // 배치 데이터 삽입/업데이트
    upsertBatchData(dataArray) {
        const results = {
            inserted: 0,
            updated: 0,
            errors: []
        };

        const data = this._readData();
        const existingMap = new Map();
        
        // 기존 데이터 맵핑
        data.production_data.forEach((item, index) => {
            const key = `${item.date}_${item.line}_${item.sequence}_${item.productName}_${item.color1}_${item.color2}`;
            existingMap.set(key, { item, index });
        });

        for (const newItem of dataArray) {
            try {
                const key = `${newItem.date}_${newItem.line}_${newItem.sequence}_${newItem.productName}_${newItem.color1}_${newItem.color2}`;
                const existing = existingMap.get(key);

                if (existing) {
                    // 업데이트
                    data.production_data[existing.index] = {
                        ...newItem,
                        id: existing.item.id,
                        created_at: existing.item.created_at,
                        updated_at: new Date().toISOString()
                    };
                    results.updated++;
                } else {
                    // 새로 추가
                    const newId = Math.max(0, ...data.production_data.map(item => item.id || 0)) + 1;
                    data.production_data.push({
                        ...newItem,
                        id: newId,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                    results.inserted++;
                }
            } catch (error) {
                results.errors.push({
                    data: newItem,
                    error: error.message
                });
            }
        }

        this._writeData(data);
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
            const data = this._readData();
            const existingMap = new Map();
            
            // 기존 데이터를 Map으로 변환
            data.production_data.forEach(item => {
                const key = `${item.date}_${item.machineNumber}_${item.moldNumber}_${item.productName}_${item.color}_${item.lotNumber}`;
                existingMap.set(key, item);
            });

            // 새 데이터와 비교
            for (const newItem of newDataArray) {
                const key = `${newItem.date}_${newItem.machineNumber}_${newItem.moldNumber}_${newItem.productName}_${newItem.color}_${newItem.lotNumber}`;
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
        const compareFields = ['unit', 'quantity', 'unitQuantity', 'remarks', 'total'];
        
        for (const field of compareFields) {
            if (oldData[field] !== newData[field]) {
                return true;
            }
        }
        
        return false;
    }

    // 개별 데이터 삭제 (ID 기반)
    deleteById(id) {
        const data = this._readData();
        const initialLength = data.production_data.length;
        
        data.production_data = data.production_data.filter(item => item.id !== parseInt(id));
        
        this._writeData(data);
        return {
            deleted: initialLength - data.production_data.length,
            remaining: data.production_data.length
        };
    }

    // 다중 ID로 데이터 삭제
    deleteByIds(ids) {
        const data = this._readData();
        const initialLength = data.production_data.length;
        const idsToDelete = ids.map(id => parseInt(id));
        
        data.production_data = data.production_data.filter(item => !idsToDelete.includes(item.id));
        
        this._writeData(data);
        return {
            deleted: initialLength - data.production_data.length,
            remaining: data.production_data.length
        };
    }

    // 날짜별 데이터 삭제
    deleteByDate(date) {
        const data = this._readData();
        const initialLength = data.production_data.length;
        
        data.production_data = data.production_data.filter(item => item.date !== date);
        
        this._writeData(data);
        return {
            deleted: initialLength - data.production_data.length,
            remaining: data.production_data.length
        };
    }

    // 다중 날짜로 데이터 삭제
    deleteByDates(dates) {
        const data = this._readData();
        const initialLength = data.production_data.length;
        
        data.production_data = data.production_data.filter(item => !dates.includes(item.date));
        
        this._writeData(data);
        return {
            deleted: initialLength - data.production_data.length,
            remaining: data.production_data.length
        };
    }

    // 전체 데이터 삭제
    deleteAll() {
        const data = this._readData();
        const deletedCount = data.production_data.length;
        
        data.production_data = [];
        
        this._writeData(data);
        return {
            deleted: deletedCount,
            remaining: 0
        };
    }

    // 조건부 삭제 (필터 기반)
    deleteByCondition(conditions) {
        const data = this._readData();
        const initialLength = data.production_data.length;
        
        data.production_data = data.production_data.filter(item => {
            // 조건에 맞지 않는 데이터만 남김 (조건에 맞는 데이터는 삭제)
            for (const [field, value] of Object.entries(conditions)) {
                if (Array.isArray(value)) {
                    if (value.includes(item[field])) return false; // 삭제 대상
                } else {
                    if (item[field] === value) return false; // 삭제 대상
                }
            }
            return true; // 유지 대상
        });
        
        this._writeData(data);
        return {
            deleted: initialLength - data.production_data.length,
            remaining: data.production_data.length
        };
    }

    // 삭제된 데이터 통계
    getDeleteStats(deletedIds) {
        const data = this._readData();
        const deletedData = [];
        
        for (const id of deletedIds) {
            // 실제로는 이미 삭제되었으므로 로그 목적으로만 사용
        }
        
        return {
            totalRemaining: data.production_data.length,
            dateStats: this.getGroupedByDate()
        };
    }

    // 데이터베이스 연결 종료 (JSON에서는 불필요하지만 호환성을 위해 유지)
    close() {
        console.log('JSON 데이터베이스 세션 종료');
    }
}

module.exports = ProductionDatabase;