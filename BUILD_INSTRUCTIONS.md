# 생산계획 대시보드 - 실행파일 빌드 가이드

## 개요
이 프로젝트는 Node.js를 사용하여 개발된 생산계획 관리 대시보드입니다. 
`pkg` 패키지를 사용하여 독립 실행 가능한 바이너리 파일로 패키징할 수 있습니다.

## 빌드 전 요구사항
- Node.js (버전 16 이상)
- npm 또는 yarn

## 설치 및 빌드

### 1. 의존성 설치
```bash
npm install
```

### 2. 실행파일 빌드

#### Windows용 실행파일 빌드
```bash
# (선택) 사전 시드: Excel→DB, CSV→JSON
# node scripts/seed-before-build.js

npm run build:win
```
출력: `./dist/production-dashboard-win.exe`

#### Linux용 실행파일 빌드
```bash
npm run build:linux
```
출력: `./dist/production-dashboard-linux`

#### 모든 플랫폼용 빌드
```bash
npm run build:all
```
출력: 
- `./dist/production-dashboard-win.exe` (Windows)
- `./dist/production-dashboard-linux` (Linux)
- `./dist/production-dashboard-macos` (macOS)

#### 기본 빌드 (Windows + Linux)
```bash
npm run build
```

## 실행 방법

### Windows
```cmd
./dist/production-dashboard-win.exe
```

### Linux/macOS
```bash
chmod +x ./dist/production-dashboard-linux
./dist/production-dashboard-linux
```

## 빌드에 포함되는 파일들
- `server.js` (메인 서버 파일)
- `index.html` (메인 대시보드)
- `production-log.html` (생산계획 페이지)
- `redirect.html` (리다이렉트 페이지)
- `css/` 디렉토리의 모든 스타일 파일
- `js/` 디렉토리의 모든 JavaScript 파일
- `sales/` 디렉토리의 모든 분석 페이지 파일
- `examples/` 디렉토리의 모든 예제 파일 (생산일지.xlsx 포함)
- `credentials.json` (Google API 인증 파일)

## 실행 후 접속 및 데이터 I/O
실행파일을 실행하면 다음 주소로 접속할 수 있습니다:
- 로컬: http://localhost:5173
- 외부: http://bonohouse.p-e.kr:5173 (DNS 설정된 경우)

### 출고 DB 내보내기/가져오기
- JSON 다운로드: `GET /api/delivery/export.json`
- 엑셀 다운로드: `GET /api/delivery/export.xlsx`
- 업로드(JSON/CSV): `POST /api/delivery/import` (multipart form field: `file`)
- 업로드(엑셀): `POST /api/delivery/import-excel` (multipart form field: `file`)

## 주요 기능
1. **출고 현황 대시보드**: 시간별 배송 데이터 시각화
2. **생산계획 관리**: Excel 파일 기반 생산 데이터 관리
3. **실시간 동기화**: 파일 변경 시 자동 업데이트
4. **비즈니스 분석**: 매출 및 성과 분석 도구

## 트러블슈팅

### 빌드 실패 시
1. Node.js 버전 확인: `node --version` (16 이상 필요)
2. 캐시 정리: `npm cache clean --force`
3. node_modules 재설치: `rm -rf node_modules && npm install`

### 실행 시 파일을 찾을 수 없다는 오류
- credentials.json 파일이 실행파일과 같은 디렉토리에 있는지 확인
- examples/생산일지.xlsx 파일이 올바른 위치에 있는지 확인

### 포트 충돌 오류
- 다른 프로그램이 5173 포트를 사용 중인지 확인
- Windows: `netstat -ano | findstr :5173`
- Linux: `lsof -i :5173`

## 파일 크기 최적화
실행파일 크기를 줄이려면:
1. 불필요한 의존성 제거
2. assets에서 불필요한 파일 패턴 제외
3. Node.js 버전을 낮추기 (단, 호환성 확인 필요)

현재 설정으로 빌드된 실행파일 크기는 약 100-150MB입니다.
