class DataManager {
    constructor(apiBase) {
        this.apiBase = apiBase;
        this.daily = []; // [{date, ea_qty, box_qty, amount}]
        this.raw = [];   // 원자료 (테이블용)
        this.summary = [];// 카테고리 합계
        this.dailyCategorySummary = null; // 서버 집계 결과 캐시
    }

    async initRecent7() {
        // 최근 7일: 서버에 최근 구간 인식 기능이 없어, 우선 전체 기간을 추정하지 않고
        // 오늘 기준으로 30일→점차 넓히는 전략 대신, 첫 초기화는 VF CSV 시드 상태에서 가장 최근 7일을 클라이언트에서 계산
        // 간편화를 위해 오늘-60일 범위를 요청하고 그 중 마지막 7일을 사용
        const today = new Date();
        const end = today.toISOString().slice(0,10);
        const s = new Date(today); s.setDate(s.getDate() - 60);
        const start = s.toISOString().slice(0,10);
        await this.loadRange(start, end);
        // daily는 정렬되어 있음. 마지막 7개 사용
        if (this.daily.length > 7) this.daily = this.daily.slice(-7);
        // summary는 선택 구간 기준 재계산 필요
        await this.loadSummary(this.daily[0]?.date || start, this.daily[this.daily.length-1]?.date || end);
        await this.loadRaw(this.daily[0]?.date || start, this.daily[this.daily.length-1]?.date || end);
        return this.daily;
    }

    async loadRange(start, end) {
        const url = `${this.apiBase}/api/sales/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load sales range: ${res.status}`);
        const js = await res.json();
        if (!js.success) throw new Error('API returned error');
        this.daily = Array.isArray(js.data) ? js.data.sort((a,b)=> a.date.localeCompare(b.date)) : [];
        return this.daily;
    }

    async loadSummary(start, end) {
        const url = `${this.apiBase}/api/sales/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load sales summary: ${res.status}`);
        const js = await res.json();
        if (!js.success) throw new Error('API returned error');
        this.summary = Array.isArray(js.data) ? js.data : [];
        return this.summary;
    }

    async loadRaw(start, end, page = 1, pageSize = 100) {
        const url = `${this.apiBase}/api/sales/raw?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&page=${page}&pageSize=${pageSize}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load sales raw: ${res.status}`);
        const js = await res.json();
        if (!js.success) throw new Error('API returned error');
        this.raw = Array.isArray(js.data) ? js.data : [];
        return { total: js.total || this.raw.length, data: this.raw };
    }

    async loadDailyCategorySummary(start, end) {
        if (!this.apiBase) { this.dailyCategorySummary = null; return null; }
        const url = `${this.apiBase}/api/sales/daily-category?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) { this.dailyCategorySummary = null; return null; }
        const js = await res.json().catch(()=>null);
        if (!js || !js.success || !Array.isArray(js.data)) { this.dailyCategorySummary = null; return null; }
        this.dailyCategorySummary = js.data;
        return this.dailyCategorySummary;
    }

    // 카테고리별 합계 (metric: 'box' | 'ea' | 'amount')
    getCategoryAmounts(metric = 'box') {
        const field = metric === 'amount' ? 'amount' : (metric === 'ea' ? 'ea_qty' : 'box_qty');
        const labels = this.summary.map(s => s.category);
        const values = this.summary.map(s => s[field] || 0);
        return { labels, values };
    }

    // 카테고리별 박스/금액 동시 반환
    getCategoryBoxAndAmount() {
        const labels = this.summary.map(s => s.category);
        const boxValues = this.summary.map(s => s.box_qty || 0);
        const amountValues = this.summary.map(s => s.amount || 0);
        return { labels, boxValues, amountValues };
    }

    // 일별 추이 (metric)
    getTrend(metric = 'box') {
        const field = metric === 'amount' ? 'amount' : (metric === 'ea' ? 'ea_qty' : 'box_qty');
        const labels = this.daily.map(d => d.date);
        const values = this.daily.map(d => d[field] || 0);
        return { labels, values };
    }

    // 일별 박스/금액 동시 반환
    getTrendBoxAndAmount() {
        const labels = this.daily.map(d => d.date);
        const boxValues = this.daily.map(d => d.box_qty || 0);
        const amountValues = this.daily.map(d => d.amount || 0);
        return { labels, boxValues, amountValues };
    }

    // 일자+분류 요약: 박스 수량 합계
    getDailyCategorySummary() {
        if (Array.isArray(this.dailyCategorySummary)) return this.dailyCategorySummary;
        const agg = new Map(); // key: `${date}__${category}`
        for (const r of this.raw) {
            const date = r.date;
            const cat = r.category || '-';
            const key = `${date}__${cat}`;
            const cur = agg.get(key) || { date, category: cat, box_qty: 0, ea_qty: 0, amount: 0 };
            cur.box_qty += r.box_qty || 0;
            cur.ea_qty += r.ea_qty || 0;
            cur.amount += r.amount || 0;
            agg.set(key, cur);
        }
        return Array.from(agg.values()).sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category));
    }

    // 세부 품목: 특정 일자+분류에서 품목별 박스 수량 합계
    async getItemsByDateCategory(date, category) {
        if (this.apiBase) {
            try {
                const url = `${this.apiBase}/api/sales/items?date=${encodeURIComponent(date)}&category=${encodeURIComponent(category || '')}`;
                const res = await fetch(url, { cache: 'no-store' });
                if (res.ok) {
                    const js = await res.json();
                    if (js && js.success && Array.isArray(js.data)) {
                        return js.data;
                    }
                }
            } catch (_) {}
        }
        // fallback to client-side aggregation
        const agg = new Map();
        for (const r of this.raw) {
            if (r.date !== date) continue;
            if ((r.category || '-') !== (category || '-')) continue;
            const key = r.item || '-';
            const cur = agg.get(key) || { item: key, box_qty: 0, ea_qty: 0, amount: 0 };
            cur.box_qty += r.box_qty || 0;
            cur.ea_qty += r.ea_qty || 0;
            cur.amount += r.amount || 0;
            agg.set(key, cur);
        }
        return Array.from(agg.values()).sort((a, b) => b.box_qty - a.box_qty || a.item.localeCompare(b.item));
    }
}
