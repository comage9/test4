Windows 배포 및 실행 가이드

1) 빌드 준비
- Node.js 18+ 설치 (권장: 18 LTS 또는 20)
- PowerShell에서 프로젝트 디렉터리로 이동
- 의존성 설치: `npm ci`

2) 윈도우 실행 파일 빌드
- 기본 빌드: `npm run build:win`
  - 산출물: `dist/production-dashboard-win.exe`
- 전체 플랫폼 빌드(옵션): `npm run build:all`

3) 실행 전 환경 변수(권장)
- 데이터베이스 경로 고정(초기화 방지):
  - PowerShell: `$env:DELIVERY_DB_PATH = "E:\\YourPath\\delivery-data.json"`
  - CMD: `set DELIVERY_DB_PATH=E:\\YourPath\\delivery-data.json`
  - 미설정 시, 실행 파일과 같은 폴더의 `delivery-data.json`을 사용합니다.
- 포트 지정(옵션): `$env:PORT = 5174`

4) 실행
- `dist/production-dashboard-win.exe`
- 브라우저 접속: `http://localhost:5174`

5) 파일 경로 안내
- 정적 파일: 실행 파일 내부(snapshots)에서 서빙됩니다.
- 쓰기 경로(실행 파일과 동일 폴더):
  - 업로드: `./uploads` (없으면 자동 생성)
  - DB: `DELIVERY_DB_PATH` 지정 경로 또는 `./delivery-data.json`
  - 로그: `./server.log`

6) 점검 API
- `GET /api/delivery/info` → DB 경로, 파일 크기, 수정 시간 확인

7) 문제 해결 팁
- 데이터가 초기화되는 문제: `DELIVERY_DB_PATH`로 경로 고정 후 실행
- 엑셀 업로드 실패: 파일 확장자 `.xlsx/.xls`인지 확인, 10MB 제한
- 기간 조회 실패: 서버와 동일 오리진에서 페이지 접근 (`http://localhost:5174`)
