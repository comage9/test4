document.addEventListener('DOMContentLoaded', async () => {
    const dataManager = new DataManager('data/sample_data.csv');
    const chartRenderer = new ChartRenderer('category-chart');

    const tableBody = document.querySelector('#data-table tbody');
    const uploadBtn = document.getElementById('upload-btn');
    const downloadBtn = document.getElementById('download-btn');
    const fileInput = document.getElementById('csv-upload');

    async function init() {
        const success = await dataManager.loadData();
        if (success) {
            renderTable();
            renderChart();
        }
    }

    function renderTable() {
        tableBody.innerHTML = '';
        const data = dataManager.getPaginatedData(1, 100); // Show first 100 rows
        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.id}</td>
                <td>${row['일자']}</td>
                <td>${row['바코드']}</td>
                <td>${row['수량(박스)']}</td>
                <td>${row['수량(낱개)']}</td>
                <td>${row['품목']}</td>
                <td>${row['분류']}</td>
                <td>${row['판매금액']}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function renderChart() {
        const salesByCategory = dataManager.getSalesByCategory();
        chartRenderer.renderCategoryChart(salesByCategory);
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            dataManager.parseCSV(text);
            renderTable();
            renderChart();
        };
        reader.readAsText(file, 'EUC-KR');
    }

    function handleDownload() {
        let csvContent = dataManager.headers.join(',') + '\n';
        dataManager.data.forEach(row => {
            csvContent += Object.values(row).join(',') + '\n';
        });

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'business_analysis.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    downloadBtn.addEventListener('click', handleDownload);

    init();
});
