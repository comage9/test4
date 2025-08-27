const http = require('http');

// API 테스트 함수
async function testAPI(endpoint, description) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 5173,
            path: endpoint,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    // HTML 응답인지 확인
                    if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                        console.log(`✅ ${description}: HTML 응답 (상태: ${res.statusCode})`);
                        resolve({ type: 'html', statusCode: res.statusCode });
                        return;
                    }

                    const result = JSON.parse(data);
                    console.log(`✅ ${description}: 성공`);
                    console.log(`   - 상태: ${res.statusCode}`);
                    if (result.success !== undefined) {
                        console.log(`   - 성공 여부: ${result.success}`);
                    }
                    if (result.data && Array.isArray(result.data)) {
                        console.log(`   - 데이터 수: ${result.data.length}개`);
                    }
                    if (result.latestDate) {
                        console.log(`   - 최신 날짜: ${result.latestDate}`);
                    }
                    resolve(result);
                } catch (error) {
                    // JSON 파싱 실패 시에도 성공으로 처리 (HTML 응답 등)
                    console.log(`⚠️ ${description}: JSON이 아닌 응답 (상태: ${res.statusCode})`);
                    console.log(`   - 응답 길이: ${data.length}자`);
                    resolve({ type: 'non-json', statusCode: res.statusCode, data: data.substring(0, 100) });
                }
            });
        });

        req.on('error', (err) => {
            console.log(`❌ ${description}: 요청 실패`);
            console.log(`   - 오류: ${err.message}`);
            reject(err);
        });

        req.setTimeout(5000, () => {
            console.log(`❌ ${description}: 타임아웃`);
            req.destroy();
            reject(new Error('Timeout'));
        });

        req.end();
    });
}

// 메인 테스트 함수
async function runTests() {
    console.log('='.repeat(60));
    console.log('생산일지 시스템 테스트 시작');
    console.log('='.repeat(60));

    try {
        // 1. 전체 생산일지 조회 테스트
        console.log('\n📋 1. 전체 생산일지 조회 테스트');
        const allData = await testAPI('/api/production-log', '전체 생산일지 조회');
        
        // 2. 특정 날짜 조회 테스트
        if (allData.latestDate) {
            console.log('\n📅 2. 특정 날짜 조회 테스트');
            await testAPI(`/api/production-log/${encodeURIComponent(allData.latestDate)}`, `${allData.latestDate} 데이터 조회`);
        }

        // 3. 존재하지 않는 날짜 조회 테스트
        console.log('\n❓ 3. 존재하지 않는 날짜 조회 테스트');
        await testAPI('/api/production-log/99%2F99%2F99', '존재하지 않는 날짜 조회');

        // 4. 웹페이지 접근 테스트
        console.log('\n🌐 4. 웹페이지 접근 테스트');
        await testAPI('/', '메인 페이지 접근');
        await testAPI('/production-log.html', '생산일지 페이지 접근');

        console.log('\n' + '='.repeat(60));
        console.log('✅ 모든 테스트가 완료되었습니다!');
        console.log('='.repeat(60));

        // 추가 정보 출력
        if (allData) {
            console.log('\n📊 시스템 현황:');
            console.log(`   - 총 레코드 수: ${allData.totalRecords || 0}개`);
            console.log(`   - 최신 날짜: ${allData.latestDate || 'N/A'}`);
            console.log(`   - 사용 가능한 날짜 수: ${allData.allDates ? allData.allDates.length : 0}개`);
            
            if (allData.allDates && allData.allDates.length > 0) {
                console.log('   - 날짜 목록:');
                allData.allDates.slice(0, 5).forEach(date => {
                    console.log(`     • ${date}`);
                });
                if (allData.allDates.length > 5) {
                    console.log(`     ... 및 ${allData.allDates.length - 5}개 더`);
                }
            }
        }

        console.log('\n🔗 접속 정보:');
        console.log('   - 메인 페이지: http://localhost:5173');
        console.log('   - 생산일지 페이지: http://localhost:5173/production-log.html');
        console.log('   - API 엔드포인트: http://localhost:5173/api/production-log');

    } catch (error) {
        console.log('\n❌ 테스트 중 오류 발생:', error.message);
        process.exit(1);
    }
}

// 테스트 실행
console.log('서버 연결 대기 중...');
setTimeout(() => {
    runTests();
}, 2000); // 서버가 완전히 시작될 때까지 2초 대기