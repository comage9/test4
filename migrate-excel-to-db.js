const XLSX = require('xlsx');
const path = require('path');
const ProductionDatabase = require('./database');

function migrateExcelToDatabase() {
    const db = new ProductionDatabase();
    
    try {
        console.log('Excel 데이터 마이그레이션 시작...');
        
        // Excel 파일 경로 - 전체 데이터가 있는 백업 파일 사용
        const excelPath = path.join(__dirname, 'examples', '생산일지-full.xlsx');
        console.log('Excel 파일 경로:', excelPath);
        
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
        
        // 데이터 구조화
        const structuredData = jsonData.map((row, index) => {
            if (index === 0 || !row[0]) return null; // 헤더나 빈 행 건너뛰기
            
            return {
                date: row[0] || '',
                line: row[1] || '',
                sequence: row[2] || '',
                productName: row[3] || '',
                productNameEng: row[4] || '',
                color1: row[5] || '',
                color2: row[6] || '',
                unit: row[7] || '',                    // 실제 Excel: "단위"
                quantity: parseInt(row[8]) || 0,       // 실제 Excel: "생산수량"  
                unitQuantity: parseInt(row[9]) || 0,   // 실제 Excel: "생산단위"
                reserved: row[10] || '',
                total: parseInt(row[11]?.toString().replace(/\s/g, '')) || 0
            };
        }).filter(item => item !== null);
        
        console.log(`구조화된 데이터: ${structuredData.length}개`);
        
        // 데이터베이스에 배치 삽입
        console.log('데이터베이스에 삽입 중...');
        const results = db.upsertBatchData(structuredData);
        
        console.log('=== 마이그레이션 완료 ===');
        console.log(`삽입된 데이터: ${results.inserted}개`);
        console.log(`업데이트된 데이터: ${results.updated}개`);
        console.log(`오류 발생: ${results.errors.length}개`);
        
        if (results.errors.length > 0) {
            console.log('오류 상세:');
            results.errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error.error}`);
            });
        }
        
        // 마이그레이션 확인
        const allData = db.getAllData();
        console.log(`데이터베이스 총 레코드 수: ${allData.length}개`);
        
        // 날짜별 통계
        const groupedData = db.getGroupedByDate();
        console.log('\n날짜별 데이터 통계:');
        groupedData.forEach(item => {
            console.log(`${item.date}: ${item.count}개 (총량: ${item.totalQuantity})`);
        });
        
    } catch (error) {
        console.error('마이그레이션 실패:', error);
    } finally {
        db.close();
    }
}

// 직접 실행 시
if (require.main === module) {
    migrateExcelToDatabase();
}

module.exports = migrateExcelToDatabase;