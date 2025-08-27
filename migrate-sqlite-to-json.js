const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// SQLite 데이터가 없으면 Excel에서 직접 마이그레이션
function migrateToJson() {
    console.log('JSON 데이터베이스로 마이그레이션 시작...');
    
    try {
        // Excel 파일에서 데이터 읽기
        const excelPath = path.join(__dirname, 'examples', '생산일지-full.xlsx');
        console.log('Excel 파일 경로:', excelPath);
        
        if (!fs.existsSync(excelPath)) {
            console.error('Excel 파일을 찾을 수 없습니다:', excelPath);
            return;
        }

        // Excel 파일 읽기
        const workbook = XLSX.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // JSON으로 변환
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1,
            defval: '',
            raw: false
        });
        
        console.log(`총 ${jsonData.length}개 행 발견`);
        
        // 데이터 구조화 - 기존 데이터를 새로운 필드 구조로 매핑
        const structuredData = jsonData.map((row, index) => {
            if (index === 0 || !row[0]) return null; // 헤더나 빈 행 건너뛰기
            
            return {
                id: index,
                date: row[0] || '',                    // 일자
                machineNumber: row[1] || '',           // 기계번호 (기존: line)
                moldNumber: row[2] || '',              // 몰드번호 (기존: sequence)
                productName: row[3] || '',             // 제품명
                productNameEng: row[4] || '',          // 제품명(영문)
                color: row[5] || '',                   // 색상 (기존: color1)
                lotNumber: row[6] || '',               // 롯트번호 (기존: color2)
                unit: row[7] || '',                    // 단위
                quantity: parseInt(row[8]) || 0,       // 생산수량
                unitQuantity: parseInt(row[9]) || 0,   // 생산단위
                remarks: row[10] || '',                // 비고 (기존: reserved)
                total: parseInt(row[11]?.toString().replace(/\s/g, '')) || 0, // 작업예정수량
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
        }).filter(item => item !== null);
        
        console.log(`구조화된 데이터: ${structuredData.length}개`);
        
        // JSON 데이터베이스 파일 생성
        const jsonDbPath = path.join(__dirname, 'production-data.json');
        const jsonData_final = {
            production_data: structuredData,
            metadata: {
                created_at: new Date().toISOString(),
                version: "1.0.0",
                migrated_from: "excel",
                total_records: structuredData.length
            }
        };
        
        fs.writeFileSync(jsonDbPath, JSON.stringify(jsonData_final, null, 2));
        
        console.log('=== 마이그레이션 완료 ===');
        console.log(`JSON 파일 생성: ${jsonDbPath}`);
        console.log(`총 레코드 수: ${structuredData.length}개`);
        
        // 날짜별 통계
        const dateStats = {};
        structuredData.forEach(item => {
            if (!dateStats[item.date]) {
                dateStats[item.date] = { count: 0, totalQuantity: 0 };
            }
            dateStats[item.date].count++;
            dateStats[item.date].totalQuantity += item.total || 0;
        });
        
        console.log('\n날짜별 데이터 통계:');
        Object.entries(dateStats).forEach(([date, stats]) => {
            console.log(`${date}: ${stats.count}개 (총량: ${stats.totalQuantity})`);
        });
        
    } catch (error) {
        console.error('마이그레이션 실패:', error);
    }
}

// 직접 실행 시
if (require.main === module) {
    migrateToJson();
}

module.exports = { migrateToJson };