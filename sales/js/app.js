document.addEventListener('DOMContentLoaded', async () => {
    // API 베이스 자동 탐지 (index.html과 동일 전략)
    async function detectApiBase() {
        const host = location.hostname || 'localhost';
        const candidates = [];
        candidates.push(location.origin);
        for (let p = 5174; p <= 5181; p++) {
            const base = `${location.protocol}//${host}:${p}`;
            if (!candidates.includes(base)) candidates.push(base);
        }
        for (const base of candidates) {
            try {
                const res = await fetch(`${base}/api/delivery/hourly?days=1`, { cache: 'no-store' });
                if (!res.ok) continue;
                const js = await res.json();
                if (js && js.success) return base;
            } catch (_) {}
        }
        // API 서버를 찾지 못한 경우 빈 문자열 반환 (업로드/조회 비활성화)
        return '';
    }

    const apiBase = await detectApiBase();
    const dataManager = new DataManager(apiBase);
    const catChart = new ChartRenderer('category-chart');
    const trendChart = new ChartRenderer('trend-chart');

    const summaryTbody = document.getElementById('summary-tbody');
    const detailTbody = document.getElementById('detail-tbody');
    const summarySection = document.getElementById('summary-section');
    const detailSection = document.getElementById('detail-section');
    const detailTitle = document.getElementById('detail-title');
    const uploadBtn = document.getElementById('upload-btn');
    const downloadBtn = document.getElementById('download-btn');
    const fileInput = document.getElementById('csv-upload');
    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    const filterBtn = document.getElementById('filter-btn');
    const apiStatus = document.getElementById('api-status');
    const metricRadios = document.querySelectorAll('input[name="metric"]');
    const categorySelect = document.getElementById('category-select');
    const searchInput = document.getElementById('search-input');
    const summaryDownloadBtn = document.getElementById('summary-download');
    const detailDownloadBtn = document.getElementById('detail-download');

    // API 상태 표시 및 컨트롤 활성/비활성
    function updateApiUiState() {
        const ok = !!apiBase;
        if (apiStatus) {
            apiStatus.classList.remove('badge-success', 'badge-warning', 'badge-error');
            apiStatus.classList.add(ok ? 'badge-success' : 'badge-warning');
            apiStatus.textContent = ok ? 'API 연결됨' : 'API 미연결';
        }
        // 업로드/조회 컨트롤 상태
        [uploadBtn, downloadBtn, fileInput, filterBtn, startInput, endInput].forEach(el => {
            if (!el) return;
            el.disabled = !ok;
        });
        if (!ok) {
            // 안내 툴팁
            if (uploadBtn) uploadBtn.setAttribute('title', 'API 서버가 실행 중이 아닙니다. 서버를 먼저 실행하세요.');
        }
    }
    updateApiUiState();

    let selected = { date: null, category: null };
    let currentMetric = 'box';
    let currentCategories = new Set();

    async function init() {
        if (!apiBase) {
            // API가 없으면 초기 로딩 스킵
            console.warn('API server not detected. Sales dashboard controls are disabled.');
            return;
        }
        // 초기 로딩: 판매 DB 기준 최근 7일 (클라이언트에서 구간 산정)
        await dataManager.initRecent7();
        // 초기 원자료/서버 집계 로드
        if (dataManager.daily.length > 0) {
            const s = dataManager.daily[0].date;
            const e = dataManager.daily[dataManager.daily.length - 1].date;
            await dataManager.loadDailyCategorySummary(s, e);
            await dataManager.loadRaw(s, e, 1, 100000);
        }

        if (dataManager.daily.length > 0) {
            const first = dataManager.daily[0].date;
            const last = dataManager.daily[dataManager.daily.length - 1].date;
            startInput.value = first;
            endInput.value = last;
        } else {
            const today = new Date();
            const iso = today.toISOString().slice(0,10);
            startInput.value = iso;
            endInput.value = iso;
        }

        populateCategorySelect();
        renderAll();
    }

    function renderAll() {
        renderSummary();
        renderCharts();
    }

    function getFilteredSummaryRows() {
        const rows = dataManager.getDailyCategorySummary();
        const term = (searchInput?.value || '').trim().toLowerCase();
        const selectedCats = currentCategories.size > 0 ? currentCategories : null;
        return rows.filter(r => {
            const okCat = selectedCats ? selectedCats.has(r.category) : true;
            const okSearch = term ? (`${r.date} ${r.category}`.toLowerCase().includes(term)) : true;
            return okCat && okSearch;
        });
    }

    let summarySort = { key: 'date', dir: 1 }; // pivot 모드에서는 사용하지 않음(유지)
    function renderSummary() {
        if (!summaryTbody) return;
        summaryTbody.innerHTML = '';
        const rows = getFilteredSummaryRows().sort((a,b) => {
            const key = summarySort.key;
            const va = key === 'total' ? (pickMetric(a) || 0) : a[key];
            const vb = key === 'total' ? (pickMetric(b) || 0) : b[key];
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * summarySort.dir;
            return String(va).localeCompare(String(vb)) * summarySort.dir;
        });
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.classList.add('cursor-pointer');
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${r.category}</td>
                <td>${pickMetric(r)}</td>
            `;
            tr.addEventListener('click', () => showDetails(r.date, r.category));
            summaryTbody.appendChild(tr);
        });
        // 뷰 토글
        summarySection.classList.remove('hidden');
        detailSection.classList.add('hidden');
    }

    let detailSortDir = -1; // -1 desc, 1 asc
    async function showDetails(date, category) {
        selected = { date, category };
        if (detailTitle) detailTitle.textContent = `상세: ${date} · ${category}`;
        if (!detailTbody) return;
        detailTbody.innerHTML = '';
        const items = (await dataManager.getItemsByDateCategory(date, category))
            .sort((a,b)=> ((pickMetric(a)) - (pickMetric(b))) * detailSortDir);
        items.forEach(it => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${it.item}</td>
                <td>${(it.box_qty||0).toLocaleString()}</td>
                <td>${(it.amount||0).toLocaleString()}</td>
            `;
            detailTbody.appendChild(tr);
        });
        summarySection.classList.add('hidden');
        detailSection.classList.remove('hidden');
    }

    function renderCharts() {
        const cat = dataManager.getCategoryBoxAndAmount();
        catChart.renderCategoryBoxAndAmount(cat);
        const trend = dataManager.getTrendBoxAndAmount();
        trendChart.renderTrendBoxAndAmount(trend);
    }

    async function handleFilter() {
        const s = startInput.value;
        const e = endInput.value;
        if (!s || !e) return;
        await dataManager.loadRange(s, e);
        await dataManager.loadSummary(s, e);
        // 서버 집계 사용 시 원자료 로딩을 줄일 수 있으나, 폴백 대비 일부 로드
        await dataManager.loadDailyCategorySummary(s, e);
        await dataManager.loadRaw(s, e, 1, 50000);
        populateCategorySelect();
        renderAll();
    }

    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!apiBase) {
            alert('API 서버가 실행 중이 아닙니다. 업로드를 진행할 수 없습니다.');
            fileInput.value = '';
            return;
        }
        const form = new FormData();
        form.append('file', file);
        try {
            const res = await fetch(`${apiBase}/api/sales/import`, { method: 'POST', body: form });
            let js = null;
            try { js = await res.json(); } catch (_) { js = null; }
            if (!res.ok || !js || !js.success) {
                const msg = (js && (js.message || js.error)) ? (js.message || js.error) : `HTTP ${res.status}`;
                throw new Error(msg);
            }
            // 업로드 후 최근 7일 다시 로드
            await dataManager.initRecent7();
            if (dataManager.daily.length > 0) {
                startInput.value = dataManager.daily[0].date;
                endInput.value = dataManager.daily[dataManager.daily.length - 1].date;
                await dataManager.loadRaw(startInput.value, endInput.value, 1, 100000);
            }
            renderAll();
            // reset input value to allow re-upload of same file if needed
            fileInput.value = '';
        } catch (e) {
            alert('업로드 실패: ' + e.message);
        }
    }

    function handleDownload() {
        // 판매 데이터 전용 다운로드는 아직 미구현. 필요시 추가 API 제공 가능
        alert('판매 데이터 엑셀 다운로드 기능은 추후 지원됩니다.');
    }

    // 뒤로가기 버튼
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
        renderSummary();
    });

    // 메트릭 관련
    function labelForMetric(kind) {
        const name = currentMetric === 'amount' ? '금액' : (currentMetric === 'ea' ? '낱개' : '박스');
        if (kind === 'category') return `카테고리별 ${name}`;
        if (kind === 'trend') return `일별 ${name} 추이`;
        return name;
    }
    function pickMetric(obj) {
        if (currentMetric === 'amount') return obj.amount || 0;
        if (currentMetric === 'ea') return obj.ea_qty || 0;
        return obj.box_qty || 0;
    }
    metricRadios.forEach(r => r.addEventListener('change', () => {
        currentMetric = document.querySelector('input[name="metric"]:checked')?.value || 'box';
        renderAll();
    }));

    // 카테고리 멀티선택
    function populateCategorySelect() {
        if (!categorySelect) return;
        const cats = Array.from(new Set(dataManager.getDailyCategorySummary().map(r => r.category))).sort();
        categorySelect.innerHTML = '';
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            categorySelect.appendChild(opt);
        });
    }
    categorySelect?.addEventListener('change', () => {
        currentCategories = new Set(Array.from(categorySelect.selectedOptions).map(o => o.value));
        renderSummary();
    });

    // 검색
    searchInput?.addEventListener('input', () => {
        renderSummary();
    });

    // 요약 정렬(합계 헤더 클릭)
    // 정렬 헤더 제거됨(피벗 구조)

    // CSV 내보내기
    function convertToCsv(rows, headers, pickerFn) {
        const out = [headers.join(',')];
        rows.forEach(r => {
            const vals = pickerFn(r).map(v => String(v).replaceAll('"', '""'));
            out.push(vals.map(v => /[",\n]/.test(v) ? `"${v}"` : v).join(','));
        });
        return out.join('\n');
    }
    function downloadCsv(filename, content) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }
    summaryDownloadBtn?.addEventListener('click', () => {
        const rows = getFilteredSummaryRows();
        const csv = convertToCsv(rows, ['date','category','total'], r => [r.date, r.category, pickMetric(r)]);
        downloadCsv('summary.csv', csv);
    });
    detailDownloadBtn?.addEventListener('click', async () => {
        if (!selected.date) return;
        const items = await dataManager.getItemsByDateCategory(selected.date, selected.category);
        const csv = convertToCsv(items, ['item','total'], it => [it.item, pickMetric(it)]);
        downloadCsv('detail.csv', csv);
    });

    uploadBtn.addEventListener('click', () => {
        if (!apiBase) {
            alert('API 서버가 실행 중이 아닙니다. 서버를 먼저 실행하세요.');
            return;
        }
        fileInput.click();
    });
    fileInput.addEventListener('change', handleFileUpload);
    downloadBtn.addEventListener('click', handleDownload);
    filterBtn.addEventListener('click', handleFilter);

    init();
});
