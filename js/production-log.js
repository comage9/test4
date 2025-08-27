class ProductionLogManager {
    constructor() {
        this.allData = [];
        this.filteredData = [];
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.filters = {
            date: '',
            product: '',
            line: '',
            color: ''
        };
        this.eventSource = null;
        this.isRealtimeEnabled = true;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.selectedIds = new Set(); // 선택된 항목 ID 추적
        this.availableDates = []; // 사용 가능한 날짜 목록
        this.selectedDates = new Set(); // 선택된 날짜들
        
        // 단위 코드 매핑 테이블
        this.unitMapping = {
            '1': 'EA',
            '4': 'BOX',
            '9': 'BOX',
            '11': 'BOX',
            '13': 'BOX',
            '20': 'BOX',
            '30': 'BOX',
            '50': 'BOX',
            '125': 'P',
            '140': 'BOX',
            '180': 'P',
            '330': 'P'
        };
        
        this.init();
    }

    // 단위 코드를 텍스트로 변환하는 메소드 - Updated 2025-08-01
    getUnitText(unitCode) {
        return this.unitMapping[unitCode] || unitCode || '';
    }

    // 날짜 형식을 25/08/01로 변환하는 메소드
    formatDateToYYMMDD(dateStr) {
        if (!dateStr) return '';
        
        // 8/1/25 형식을 25/08/01로 변환
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const month = parts[0].padStart(2, '0');
            const day = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}/${month}/${day}`;
        }
        return dateStr;
    }

    // 데이터를 최신 날짜, 기계번호 순으로 정렬하는 메소드
    sortDataByDate() {
        this.allData.sort((a, b) => {
            // 1. 날짜로 내림차순 정렬
            const dateA = this.parseDate(a.date);
            const dateB = this.parseDate(b.date);
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;

            // 2. 날짜가 같으면 기계번호로 오름차순 정렬
            const machineA = parseInt(a.machineNumber, 10) || 0;
            const machineB = parseInt(b.machineNumber, 10) || 0;
            return machineA - machineB;
        });
    }

    // 날짜 문자열을 Date 객체로 변환하는 메소드
    parseDate(dateStr) {
        if (!dateStr) return new Date(0);
        
        // 8/1/25 형식을 2025-08-01로 변환
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const month = parseInt(parts[0]);
            const day = parseInt(parts[1]);
            const year = parseInt('20' + parts[2]); // 25 -> 2025
            return new Date(year, month - 1, day); // month는 0부터 시작
        }
        return new Date(dateStr);
    }

    async init() {
        this.setupEventListeners();
        await this.loadInitialData();
        this.setupRealtimeUpdates();
    }

    setupEventListeners() {
        // 새로고침 버튼
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadInitialData();
        });

        // 기존 date-filter는 제거됨 (다중 선택 방식으로 변경)

        document.getElementById('product-search').addEventListener('input', (e) => {
            this.filters.product = e.target.value.toLowerCase();
            this.applyFilters();
        });

        document.getElementById('line-filter').addEventListener('change', (e) => {
            this.filters.line = e.target.value;
            this.applyFilters();
        });

        document.getElementById('color-filter').addEventListener('change', (e) => {
            this.filters.color = e.target.value;
            this.applyFilters();
        });

        // 내보내기 버튼
        document.getElementById('export-btn').addEventListener('click', () => {
            this.exportToCSV();
        });

        // 전체 선택 체크박스
        document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
            this.handleSelectAll(e.target.checked);
        });

        // 선택 삭제 버튼
        document.getElementById('delete-selected-btn').addEventListener('click', () => {
            this.showDeleteConfirmModal();
        });

        // 삭제 확인 체크박스들
        document.getElementById('confirm-delete-selected').addEventListener('change', (e) => {
            document.getElementById('execute-selected-delete-btn').disabled = !e.target.checked;
        });

        document.getElementById('confirm-delete-dates').addEventListener('change', (e) => {
            this.updateDateDeleteButtonState();
        });

        // 삭제 실행 버튼들
        document.getElementById('execute-selected-delete-btn').addEventListener('click', () => {
            this.executeSelectedDelete();
        });

        document.getElementById('execute-date-delete-btn').addEventListener('click', () => {
            this.executeDateDelete();
        });

        // 날짜 필터 다중 선택 관련
        document.getElementById('select-all-dates-btn').addEventListener('click', () => {
            this.toggleAllDateFilters();
        });

        document.getElementById('apply-date-filter-btn').addEventListener('click', () => {
            this.applyDateFilter();
        });

        // 날짜별 삭제 전체 선택 버튼
        document.getElementById('select-all-delete-dates-btn').addEventListener('click', () => {
            this.toggleAllDeleteDates();
        });
    }

    async loadInitialData() {
        try {
            this.showLoading(true);
            this.updateStatus('loading', '데이터 로딩 중...');

            // 현재 호스트를 기반으로 절대 URL 구성
            const baseUrl = window.location.protocol + '//' + window.location.host;
            const apiUrl = baseUrl + '/api/production-log';
            console.log('API 요청 시작:', apiUrl);
            console.log('현재 호스트:', window.location.host);
            const response = await fetch(apiUrl);
            
            console.log('응답 상태:', response.status, response.statusText);
            console.log('응답 헤더:', response.headers.get('content-type'));

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const responseText = await response.text();
            console.log('응답 텍스트 길이:', responseText.length);
            console.log('응답 시작 부분:', responseText.substring(0, 100));

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (parseError) {
                console.error('JSON 파싱 실패:', parseError);
                console.error('응답 내용:', responseText.substring(0, 500));
                throw new Error('서버에서 잘못된 응답을 받았습니다. JSON 파싱 실패: ' + parseError.message);
            }

            if (result.success) {
                this.allData = result.data || [];
                
                // 데이터를 최신 날짜 기준으로 정렬
                this.sortDataByDate();
                
                this.availableDates = result.allDates || [];
                this.populateFilters(this.availableDates);
                this.populateDateCheckboxes(); // 날짜별 삭제 모달용 체크박스 채우기
                this.populateDateFilterCheckboxes(); // 날짜 필터용 체크박스 채우기
                
                // 초기에는 모든 날짜를 선택
                this.selectedDates = new Set(this.availableDates);
                this.updateDateFilterDisplay();
                
                this.applyFilters();
                this.updateStatus('success', '연결됨');
                console.log('데이터 로딩 완료:', this.allData.length, '개 레코드');
            } else {
                throw new Error(result.message || '데이터 로딩 실패');
            }
        } catch (error) {
            console.error('데이터 로딩 실패:', error);
            this.showError('데이터 로딩에 실패했습니다: ' + error.message);
            this.updateStatus('error', '연결 실패');
        } finally {
            this.showLoading(false);
        }
    }

    async loadDateData(date) {
        try {
            this.showLoading(true);
            
            const baseUrl = window.location.protocol + '//' + window.location.host;
            const apiUrl = baseUrl + `/api/production-log/${encodeURIComponent(date)}`;
            console.log('날짜별 API 요청:', apiUrl);
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const responseText = await response.text();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (parseError) {
                console.error('날짜별 데이터 JSON 파싱 실패:', parseError);
                console.error('응답 내용:', responseText.substring(0, 500));
                throw new Error('서버에서 잘못된 응답을 받았습니다. JSON 파싱 실패: ' + parseError.message);
            }

            if (result.success) {
                this.allData = result.data || [];
                // 날짜별 로딩일 때는 필터를 다시 채우지 않고 현재 데이터만 업데이트
                // this.populateFilters([date]); // 이 줄 제거
                this.applyFilters();
                console.log('날짜별 데이터 로딩 완료:', this.allData.length, '개 레코드');
            } else {
                throw new Error(result.message || '데이터 로딩 실패');
            }
        } catch (error) {
            console.error('날짜별 데이터 로딩 실패:', error);
            this.showError('데이터 로딩에 실패했습니다: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    populateFilters(dates) {
        // 날짜 필터는 별도 메소드에서 처리

        // 기계번호 필터 채우기
        const machines = [...new Set(this.allData.map(item => item.machineNumber))].filter(Boolean).sort();
        const lineFilter = document.getElementById('line-filter');
        if (lineFilter) {
            lineFilter.innerHTML = '<option value="">모든 기계번호</option>';
            machines.forEach(machine => {
                const option = document.createElement('option');
                option.value = machine;
                option.textContent = `기계번호 ${machine}`;
                lineFilter.appendChild(option);
            });
        }

        // 색상 필터 채우기
        const colors = [...new Set(this.allData.map(item => item.color))].filter(Boolean).sort();
        const colorFilter = document.getElementById('color-filter');
        if (colorFilter) {
            colorFilter.innerHTML = '<option value="">모든 색상</option>';
            colors.forEach(color => {
                const option = document.createElement('option');
                option.value = color;
                option.textContent = color;
                colorFilter.appendChild(option);
            });
        }
    }

    applyFilters() {
        console.log('=== 필터 적용 시작 ===');
        console.log('선택된 날짜들:', Array.from(this.selectedDates));
        console.log('전체 데이터 개수:', this.allData.length);
        
        this.filteredData = this.allData.filter(item => {
            // 날짜 필터 (다중 선택) - 날짜가 선택되지 않으면 모든 데이터 표시
            if (this.selectedDates.size > 0 && !this.selectedDates.has(item.date)) {
                return false;
            }

            // 제품명 검색
            if (this.filters.product && 
                !item.productName.toLowerCase().includes(this.filters.product) &&
                !item.productNameEng.toLowerCase().includes(this.filters.product)) {
                return false;
            }

            // 기계번호 필터
            if (this.filters.line && item.machineNumber !== this.filters.line) {
                return false;
            }

            // 색상 필터
            if (this.filters.color && item.color !== this.filters.color) {
                return false;
            }

            return true;
        });

        console.log('=== 필터링 결과 디버깅 ===');
        console.log('전체 데이터 개수:', this.allData.length);
        console.log('필터링된 데이터 개수:', this.filteredData.length);
        console.log('선택된 날짜 개수:', this.selectedDates.size);
        console.log('선택된 날짜들:', Array.from(this.selectedDates));
        if (this.allData.length > 0) {
            console.log('첫 번째 데이터 샘플:', this.allData[0]);
        }
        if (this.filteredData.length > 0) {
            console.log('첫 번째 필터링된 데이터:', this.filteredData[0]);
        } else {
            console.log('⚠️ 필터링된 데이터가 없습니다!');
        }

        this.currentPage = 1;
        this.updateTable();
        this.updatePagination();
        this.updateStatistics();
    }

    updateTable() {
        const tbody = document.getElementById('table-body');
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageData = this.filteredData.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            this.showNoData(true);
            tbody.innerHTML = '';
            return;
        }

        this.showNoData(false);

        // DocumentFragment 사용으로 성능 최적화
        const fragment = document.createDocumentFragment();
        
        // 배치로 DOM 조작 최소화
        requestAnimationFrame(() => {
            pageData.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>
                        <label>
                            <input type="checkbox" class="checkbox checkbox-sm row-checkbox" 
                                   data-id="${item.id}" 
                                   ${this.selectedIds.has(item.id) ? 'checked' : ''}
                                   onchange="productionLog.handleRowSelection(this)">
                        </label>
                    </td>
                    <td class="text-xs truncate">${this.formatDateToYYMMDD(item.date)}</td>
                    <td class="text-xs truncate">${item.machineNumber || ''}</td>
                    <td class="text-xs truncate">${item.moldNumber || ''}</td>
                    <td class="font-semibold text-sm truncate" title="${item.productName || ''}">${item.productName || ''}</td>
                    <td class="text-xs text-base-content/70 truncate" title="${item.productNameEng || ''}">${item.productNameEng || ''}</td>
                    <td class="text-center">
                        <div class="badge badge-outline badge-xs">${item.color || ''}</div>
                    </td>
                    <td class="text-xs truncate">${item.lotNumber || ''}</td>
                    <td class="text-center">
                        <div class="badge badge-xs">${item.unit || ''}</div>
                    </td>
                    <td class="text-right font-mono text-xs">${(item.quantity || 0).toLocaleString()}</td>
                    <td class="text-center">
                        <div class="badge badge-primary badge-xs">${this.getUnitText(item.unit)}</div>
                    </td>
                    <td class="text-right font-mono font-semibold text-xs">${(item.total || 0).toLocaleString()}</td>
                    <td class="text-xs truncate" title="${item.remarks || ''}">${item.remarks || ''}</td>
                `;
                fragment.appendChild(tr);
            });
            
            // 한 번에 DOM에 추가
            tbody.innerHTML = '';
            tbody.appendChild(fragment);
        });

        // 레코드 수 업데이트
        document.getElementById('record-count').textContent = `${this.filteredData.length}건`;
    }

    updatePagination() {
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        const pagination = document.getElementById('pagination');

        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let paginationHTML = '';

        // 이전 버튼
        paginationHTML += `
            <button class="join-item btn ${this.currentPage === 1 ? 'btn-disabled' : ''}" 
                    onclick="productionLog.goToPage(${this.currentPage - 1})">
                «
            </button>
        `;

        // 페이지 번호 버튼들
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="join-item btn ${i === this.currentPage ? 'btn-active' : ''}" 
                        onclick="productionLog.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        // 다음 버튼
        paginationHTML += `
            <button class="join-item btn ${this.currentPage === totalPages ? 'btn-disabled' : ''}" 
                    onclick="productionLog.goToPage(${this.currentPage + 1})">
                »
            </button>
        `;

        pagination.innerHTML = paginationHTML;
    }

    updateStatistics() {
        const totalItems = this.filteredData.length;
        const totalQuantity = this.filteredData.reduce((sum, item) => sum + item.total, 0);
        const avgUnitQuantity = totalItems > 0 ? 
            Math.round(this.filteredData.reduce((sum, item) => sum + item.unitQuantity, 0) / totalItems) : 0;

        document.getElementById('total-items').textContent = totalItems.toLocaleString();
        document.getElementById('total-quantity').textContent = totalQuantity.toLocaleString();
        document.getElementById('avg-unit-quantity').textContent = avgUnitQuantity.toLocaleString();
        document.getElementById('selected-date').textContent = this.filters.date || '전체';
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.updateTable();
            this.updatePagination();
        }
    }

    exportToCSV() {
        if (this.filteredData.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }

        const headers = ['날짜', '라인', '순서', '제품명', '제품명(영문/태국어)', '색상1', '색상2', '수량', '단위수량', '단위', '합계'];
        const csvContent = [
            headers.join(','),
            ...this.filteredData.map(item => [
                item.date,
                item.line,
                item.sequence,
                `"${item.productName}"`,
                `"${item.productNameEng}"`,
                item.color1,
                item.color2,
                item.quantity,
                item.unitQuantity,
                item.unit,
                item.total
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `생산일지_${this.filters.date || '전체'}_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    showLoading(show) {
        const loadingState = document.getElementById('loading-state');
        const table = document.getElementById('production-table');
        
        if (show) {
            loadingState.classList.remove('hidden');
            table.classList.add('opacity-50');
        } else {
            loadingState.classList.add('hidden');
            table.classList.remove('opacity-50');
        }
    }

    showNoData(show) {
        const noDataState = document.getElementById('no-data-state');
        const table = document.getElementById('production-table');
        
        if (show) {
            noDataState.classList.remove('hidden');
            table.classList.add('hidden');
        } else {
            noDataState.classList.add('hidden');
            table.classList.remove('hidden');
        }
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').showModal();
    }

    updateStatus(type, message) {
        const statusBadge = document.getElementById('status-badge');
        statusBadge.textContent = message;
        
        statusBadge.className = 'badge ';
        switch (type) {
            case 'success':
                statusBadge.className += 'badge-success';
                break;
            case 'loading':
                statusBadge.className += 'badge-warning';
                break;
            case 'error':
                statusBadge.className += 'badge-error';
                break;
            case 'realtime':
                statusBadge.className += 'badge-info';
                break;
            default:
                statusBadge.className += 'badge-neutral';
        }
    }

    setupRealtimeUpdates() {
        if (!this.isRealtimeEnabled) {
            return;
        }

        try {
            // 기존 연결이 있다면 정리
            if (this.eventSource) {
                this.eventSource.close();
            }

            // Server-Sent Events 연결 설정 - 절대 URL 사용
            const baseUrl = window.location.protocol + '//' + window.location.host;
            const eventUrl = baseUrl + '/api/production-log-events';
            console.log('SSE 연결 시작:', eventUrl);
            this.eventSource = new EventSource(eventUrl);

            this.eventSource.onopen = () => {
                console.log('실시간 업데이트 연결됨');
                this.updateStatus('realtime', '실시간 연결됨');
                this.reconnectAttempts = 0; // 연결 성공 시 재연결 시도 횟수 리셋
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleRealtimeMessage(data);
                } catch (error) {
                    console.error('실시간 메시지 파싱 실패:', error);
                }
            };

            this.eventSource.onerror = (error) => {
                console.error('실시간 업데이트 연결 오류:', error);
                this.updateStatus('error', '실시간 연결 오류');
                
                this.reconnectAttempts++;
                
                // 최대 재연결 시도 횟수 초과 시 재연결 중단
                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    console.log(`최대 재연결 시도 횟수(${this.maxReconnectAttempts})를 초과했습니다. 실시간 업데이트를 비활성화합니다.`);
                    this.isRealtimeEnabled = false;
                    this.updateStatus('error', '실시간 연결 실패');
                    this.cleanup();
                    return;
                }
                
                // 재연결 시도 (지수 백오프 적용)
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // 최대 30초
                setTimeout(() => {
                    if (this.isRealtimeEnabled) {
                        console.log(`실시간 업데이트 재연결 시도... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                        this.setupRealtimeUpdates();
                    }
                }, delay);
            };

            // 페이지 언로드 시 연결 정리
            window.addEventListener('beforeunload', () => {
                this.cleanup();
            });

        } catch (error) {
            console.error('실시간 업데이트 설정 실패:', error);
            this.updateStatus('error', '실시간 설정 실패');
        }
    }

    handleRealtimeMessage(data) {
        console.log('실시간 메시지 수신:', data);

        switch (data.type) {
            case 'connected':
                console.log('실시간 업데이트 연결 확인:', data.message);
                break;

            case 'file_updated':
                console.log('파일 업데이트 알림:', data.message);
                this.showUpdateNotification(data.message);
                // 자동으로 데이터 새로고침
                this.refreshDataAfterUpdate();
                break;

            case 'heartbeat':
                // 연결 상태 유지용 heartbeat - 별도 처리 없음
                break;

            default:
                console.log('알 수 없는 메시지 타입:', data.type);
        }
    }

    showUpdateNotification(message) {
        // 알림 토스트 표시
        const toast = document.createElement('div');
        toast.className = 'toast toast-top toast-end';
        toast.innerHTML = `
            <div class="alert alert-info">
                <div>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <span>${message}</span>
                </div>
            </div>
        `;

        document.body.appendChild(toast);

        // 3초 후 자동 제거
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    async refreshDataAfterUpdate() {
        try {
            console.log('파일 업데이트로 인한 데이터 새로고침...');
            this.updateStatus('loading', '업데이트 반영 중...');
            
            // 현재 선택된 날짜가 있다면 해당 날짜 데이터 로드, 없다면 전체 데이터 로드
            if (this.filters.date) {
                await this.loadDateData(this.filters.date);
            } else {
                await this.loadInitialData();
            }
            
            this.updateStatus('realtime', '실시간 연결됨');
            console.log('데이터 새로고침 완료');
            
        } catch (error) {
            console.error('데이터 새로고침 실패:', error);
            this.updateStatus('error', '새로고침 실패');
        }
    }

    cleanup() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            console.log('실시간 업데이트 연결 정리됨');
        }
    }

    // 실시간 업데이트 토글 (필요시 사용)
    toggleRealtimeUpdates() {
        this.isRealtimeEnabled = !this.isRealtimeEnabled;
        
        if (this.isRealtimeEnabled) {
            this.setupRealtimeUpdates();
        } else {
            this.cleanup();
            this.updateStatus('success', '연결됨');
        }
        
        return this.isRealtimeEnabled;
    }

    // 삭제 관련 메서드들 - ProductionLogManager 클래스 내부로 이동
    handleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            const id = parseInt(checkbox.dataset.id);
            if (checked) {
                this.selectedIds.add(id);
            } else {
                this.selectedIds.delete(id);
            }
        });
        this.updateSelectionUI();
    }

    handleRowSelection(checkbox) {
        const id = parseInt(checkbox.dataset.id);
        if (checkbox.checked) {
            this.selectedIds.add(id);
        } else {
            this.selectedIds.delete(id);
        }
        
        // 전체 선택 체크박스 상태 업데이트
        const allCheckboxes = document.querySelectorAll('.row-checkbox');
        const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        
        if (checkedBoxes.length === 0) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = false;
        } else if (checkedBoxes.length === allCheckboxes.length) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = true;
        } else {
            selectAllCheckbox.indeterminate = true;
        }
        
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const selectedCount = this.selectedIds.size;
        const selectedCountBadge = document.getElementById('selected-count');
        const deleteBtn = document.getElementById('delete-selected-btn');
        
        if (selectedCount > 0) {
            selectedCountBadge.textContent = `${selectedCount}개 선택됨`;
            selectedCountBadge.classList.remove('hidden');
            deleteBtn.classList.remove('hidden');
        } else {
            selectedCountBadge.classList.add('hidden');
            deleteBtn.classList.add('hidden');
        }
    }

    showDeleteConfirmModal() {
        const selectedCount = this.selectedIds.size;
        if (selectedCount === 0) return;
        
        document.getElementById('delete-count').textContent = selectedCount;
        document.getElementById('confirm-delete-selected').checked = false;
        document.getElementById('execute-selected-delete-btn').disabled = true;
        document.getElementById('deleteSelectedModal').showModal();
    }

    populateDateCheckboxes() {
        const container = document.getElementById('date-checkbox-container');
        container.innerHTML = '';
        
        this.availableDates.forEach(date => {
            const div = document.createElement('div');
            div.className = 'form-control';
            div.innerHTML = `
                <label class="cursor-pointer label justify-start gap-3">
                    <input type="checkbox" class="checkbox checkbox-sm date-checkbox" value="${date}">
                    <span class="label-text">${date}</span>
                </label>
            `;
            container.appendChild(div);
        });

        // 날짜 체크박스 변경 이벤트 리스너 추가 (이벤트 위임 사용)
        container.removeEventListener('change', this.handleDateCheckboxChange);
        this.handleDateCheckboxChange = () => {
            console.log('날짜 체크박스 변경 감지');
            this.updateDateDeleteButtonState();
            this.updateSelectAllDeleteButtonText();
        };
        container.addEventListener('change', this.handleDateCheckboxChange);
        
        // 전체 선택 버튼 텍스트 초기화
        this.updateSelectAllDeleteButtonText();
    }

    updateSelectAllDeleteButtonText() {
        const selectAllBtn = document.getElementById('select-all-delete-dates-btn');
        if (selectAllBtn) {
            const allCheckboxes = document.querySelectorAll('#date-checkbox-container .date-checkbox');
            const checkedCheckboxes = document.querySelectorAll('#date-checkbox-container .date-checkbox:checked');
            selectAllBtn.textContent = checkedCheckboxes.length === allCheckboxes.length ? '전체 해제' : '전체 선택';
        }
    }

    toggleAllDeleteDates() {
        const checkboxes = document.querySelectorAll('#date-checkbox-container .date-checkbox');
        const selectAllBtn = document.getElementById('select-all-delete-dates-btn');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        // 전체 선택/해제 토글
        const newCheckedState = !allChecked;
        checkboxes.forEach(checkbox => {
            checkbox.checked = newCheckedState;
        });
        
        // 버튼 텍스트 업데이트
        selectAllBtn.textContent = newCheckedState ? '전체 해제' : '전체 선택';
        
        // 삭제 버튼 상태 업데이트
        this.updateDateDeleteButtonState();
        
        console.log('날짜 삭제 전체 선택/해제:', newCheckedState, '선택된 날짜 수:', newCheckedState ? checkboxes.length : 0);
    }

    updateDateDeleteButtonState() {
        const dateCheckboxes = document.querySelectorAll('#date-checkbox-container .date-checkbox:checked');
        const confirmCheckbox = document.getElementById('confirm-delete-dates');
        const deleteBtn = document.getElementById('execute-date-delete-btn');
        
        // 날짜가 선택되고 확인 체크박스가 체크된 경우에만 버튼 활성화
        const hasSelectedDates = dateCheckboxes.length > 0;
        const isConfirmed = confirmCheckbox && confirmCheckbox.checked;
        
        console.log('날짜 삭제 버튼 상태 업데이트:');
        console.log('- 선택된 날짜 개수:', dateCheckboxes.length);
        console.log('- 확인 체크박스 상태:', isConfirmed);
        console.log('- 버튼 활성화 여부:', hasSelectedDates && isConfirmed);
        
        if (deleteBtn) {
            deleteBtn.disabled = !(hasSelectedDates && isConfirmed);
        }
    }

    async executeSelectedDelete() {
        const selectedIds = Array.from(this.selectedIds);
        if (selectedIds.length === 0) return;

        try {
            const response = await fetch('/api/production-log', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'ids',
                    ids: selectedIds
                })
            });

            const result = await response.json();
            
            if (result.success) {
                alert(`${result.deleted}개의 데이터가 삭제되었습니다.`);
                document.getElementById('deleteSelectedModal').close();
                this.selectedIds.clear();
                this.updateSelectionUI();
                await this.loadInitialData(); // 데이터 새로고침
            } else {
                throw new Error(result.message || '삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('삭제 실패:', error);
            alert('삭제 중 오류가 발생했습니다: ' + error.message);
        }
    }

    async executeDateDelete() {
        const selectedDates = [];
        document.querySelectorAll('.date-checkbox:checked').forEach(checkbox => {
            selectedDates.push(checkbox.value);
        });

        if (selectedDates.length === 0) return;

        try {
            const response = await fetch('/api/production-log', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'dates',
                    dates: selectedDates
                })
            });

            const result = await response.json();
            
            if (result.success) {
                alert(`${result.deleted}개의 데이터가 삭제되었습니다.`);
                document.getElementById('deleteByDatesModal').close();
                await this.loadInitialData(); // 데이터 새로고침
            } else {
                throw new Error(result.message || '삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('날짜별 삭제 실패:', error);
            alert('삭제 중 오류가 발생했습니다: ' + error.message);
        }
    }

    // 날짜 필터 관련 메서드들
    populateDateFilterCheckboxes() {
        const container = document.getElementById('date-filter-checkbox-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.availableDates.forEach(date => {
            const div = document.createElement('div');
            div.className = 'form-control';
            div.innerHTML = `
                <label class="cursor-pointer label justify-start gap-3">
                    <input type="checkbox" class="checkbox checkbox-sm date-filter-checkbox" 
                           value="${date}" ${this.selectedDates.has(date) ? 'checked' : ''}>
                    <span class="label-text">${date}</span>
                </label>
            `;
            container.appendChild(div);
            
            // 개별 체크박스 이벤트 리스너 추가
            const checkbox = div.querySelector('.date-filter-checkbox');
            checkbox.addEventListener('change', () => {
                this.handleDateFilterCheckboxChange();
            });
        });

        // 전체 선택 버튼 텍스트 업데이트
        this.updateSelectAllButtonText();
    }

    updateSelectAllButtonText() {
        const selectAllBtn = document.getElementById('select-all-dates-btn');
        if (selectAllBtn) {
            const allCheckboxes = document.querySelectorAll('.date-filter-checkbox');
            const checkedCheckboxes = document.querySelectorAll('.date-filter-checkbox:checked');
            selectAllBtn.textContent = checkedCheckboxes.length === allCheckboxes.length ? '전체 해제' : '전체 선택';
        }
    }

    toggleAllDateFilters() {
        const checkboxes = document.querySelectorAll('.date-filter-checkbox');
        const selectAllBtn = document.getElementById('select-all-dates-btn');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        // 전체 선택/해제 토글
        const newCheckedState = !allChecked;
        checkboxes.forEach(checkbox => {
            checkbox.checked = newCheckedState;
        });
        
        // 버튼 텍스트 업데이트
        selectAllBtn.textContent = newCheckedState ? '전체 해제' : '전체 선택';
        
        // selectedDates 업데이트
        this.selectedDates.clear();
        if (newCheckedState) {
            this.availableDates.forEach(date => {
                this.selectedDates.add(date);
            });
        }
        
        this.updateDateFilterDisplay();
        console.log('전체 선택/해제:', newCheckedState, '선택된 날짜 수:', this.selectedDates.size);
    }

    handleDateFilterCheckboxChange() {
        // 현재 체크된 체크박스들을 기반으로 selectedDates 업데이트
        this.selectedDates.clear();
        document.querySelectorAll('.date-filter-checkbox:checked').forEach(checkbox => {
            this.selectedDates.add(checkbox.value);
        });
        
        // 전체 선택 버튼 텍스트 업데이트
        this.updateSelectAllButtonText();
        
        this.updateDateFilterDisplay();
        
        // 실시간 필터 적용
        this.applyFilters();
        
        console.log('개별 날짜 선택 변경:', '선택된 날짜 수:', this.selectedDates.size);
    }

    applyDateFilter() {
        this.selectedDates.clear();
        
        document.querySelectorAll('.date-filter-checkbox:checked').forEach(checkbox => {
            this.selectedDates.add(checkbox.value);
        });
        
        this.updateDateFilterDisplay();
        this.applyFilters();
        document.getElementById('dateFilterModal').close();
    }

    updateDateFilterDisplay() {
        const display = document.getElementById('selected-dates-display');
        if (!display) return;
        
        if (this.selectedDates.size === 0) {
            display.textContent = '날짜를 선택하세요';
        } else if (this.selectedDates.size === this.availableDates.length) {
            display.textContent = '모든 날짜';
        } else if (this.selectedDates.size === 1) {
            display.textContent = Array.from(this.selectedDates)[0];
        } else {
            display.textContent = `${this.selectedDates.size}개 날짜 선택됨`;
        }
    }
}

// 전역 인스턴스 생성
let productionLog;

// 파일 업로드 관리 클래스
class FileUploadManager {
    constructor() {
        this.fileInput = document.getElementById('file-input');
        this.uploadBtn = document.getElementById('upload-btn');
        this.dropZone = document.getElementById('drop-zone');
        this.fileInfo = document.getElementById('file-info');
        this.uploadProgress = document.getElementById('upload-progress');
        this.progressBar = document.getElementById('progress-bar');
        this.progressText = document.getElementById('progress-text');
        
        this.selectedFile = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // 파일 선택 이벤트
        this.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        // 드래그 앤 드롭 이벤트
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('border-primary');
        });

        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('border-primary');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('border-primary');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });

        // 업로드 버튼 클릭
        this.uploadBtn.addEventListener('click', () => {
            this.uploadFile();
        });
    }

    handleFileSelect(file) {
        if (!file) return;

        // 파일 형식 검증
        const allowedTypes = ['.xlsx', '.xls', '.csv', '.txt'];
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!allowedTypes.includes(fileExt)) {
            this.showError('지원되지 않는 파일 형식입니다. Excel(.xlsx, .xls), CSV(.csv), 텍스트(.txt) 파일만 업로드 가능합니다.');
            return;
        }

        // 파일 크기 검증 (10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.showError('파일 크기가 너무 큽니다. 10MB 이하의 파일만 업로드 가능합니다.');
            return;
        }

        this.selectedFile = file;
        this.updateFileInfo(file);
        this.uploadBtn.disabled = false;
    }

    updateFileInfo(file) {
        const fileSize = this.formatFileSize(file.size);
        
        document.getElementById('selected-filename').textContent = file.name;
        document.getElementById('selected-filesize').textContent = fileSize;
        
        this.fileInfo.classList.remove('hidden');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async uploadFile() {
        if (!this.selectedFile) return;

        this.uploadBtn.disabled = true;
        this.uploadProgress.classList.remove('hidden');

        const formData = new FormData();
        formData.append('productionFile', this.selectedFile);

        try {
            const response = await fetch('/api/upload-production-file', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccess(`파일이 성공적으로 업로드되었습니다.\\n백업 파일: ${result.backupFile}`);
                this.resetForm();
                document.getElementById('uploadModal').close();
                
                // 데이터 새로고침
                if (window.productionLog) {
                    window.productionLog.loadInitialData();
                }
            } else {
                this.showError(result.message || '파일 업로드에 실패했습니다.');
            }
        } catch (error) {
            console.error('업로드 오류:', error);
            this.showError('파일 업로드 중 오류가 발생했습니다: ' + error.message);
        } finally {
            this.uploadBtn.disabled = false;
            this.uploadProgress.classList.add('hidden');
        }
    }

    resetForm() {
        this.selectedFile = null;
        this.fileInput.value = '';
        this.fileInfo.classList.add('hidden');
        this.uploadBtn.disabled = true;
        this.progressBar.value = 0;
        this.progressText.textContent = '0%';
    }

    showSuccess(message) {
        // 기존 토스트나 알림 시스템이 있다면 사용, 없으면 alert 사용
        alert(message);
    }

    showError(message) {
        // 기존 에러 모달 사용
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').showModal();
    }

}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    productionLog = new ProductionLogManager();
    window.fileUpload = new FileUploadManager();
});// Cache bust: Fri Aug  1 19:35:01 KST 2025
// Cache bust: Fri Aug  1 19:48:12 KST 2025
