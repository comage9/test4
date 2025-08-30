class ChartRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.chart = null;
        // 고정 크기 기본값 (캔버스 속성으로 지정 시 Chart.js가 그대로 사용)
        if (!this.canvas.width) this.canvas.width = 1200;
        if (!this.canvas.height) this.canvas.height = 420;
    }

    destroy() { if (this.chart) { this.chart.destroy(); this.chart = null; } }

    renderCategoryBoxAndAmount({ labels, boxValues, amountValues }) {
        this.destroy();
        this.chart = new Chart(this.ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { // 박스 수량 - 막대
                        label: '수량(박스)'
                        ,data: boxValues
                        ,backgroundColor: 'rgba(37, 99, 235, 0.5)'
                        ,borderColor: 'rgba(37, 99, 235, 1)'
                        ,yAxisID: 'y'
                        ,order: 1
                    },
                    { // 판매금액 - 선
                        label: '판매금액'
                        ,type: 'line'
                        ,data: amountValues
                        ,borderColor: 'rgba(234, 88, 12, 1)'
                        ,backgroundColor: 'rgba(234, 88, 12, 0.2)'
                        ,tension: 0.2
                        ,yAxisID: 'y2'
                        ,order: 0
                    }
                ]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: '박스' } },
                    y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '금액' },
                      ticks: { callback: (v)=> (v??0).toLocaleString() }
                    }
                }
            }
        });
    }

    renderTrendBoxAndAmount({ labels, boxValues, amountValues }) {
        this.destroy();
        this.chart = new Chart(this.ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { // 박스 - 영역선 + 라벨
                        label: '수량(박스)'
                        ,data: boxValues
                        ,borderColor: 'rgba(37, 99, 235, 1)'
                        ,backgroundColor: 'rgba(37, 99, 235, 0.2)'
                        ,tension: 0.2
                        ,fill: true
                        ,yAxisID: 'y'
                        ,datalabels: { align: 'top', anchor: 'end', color: '#111', formatter: v => (v ?? 0).toLocaleString() }
                    },
                    { // 금액 - 선
                        label: '판매금액'
                        ,data: amountValues
                        ,borderColor: 'rgba(234, 88, 12, 1)'
                        ,backgroundColor: 'rgba(234, 88, 12, 0.2)'
                        ,tension: 0.2
                        ,yAxisID: 'y2'
                    }
                ]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    datalabels: {
                        display: (ctx) => ctx.datasetIndex === 0
                    }
                },
                scales: {
                    x: { ticks: { autoSkip: true, maxRotation: 0 } },
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: '박스' } },
                    y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '금액' },
                      ticks: { callback: (v)=> (v??0).toLocaleString() }
                    }
                }
            }
        });
    }
}
