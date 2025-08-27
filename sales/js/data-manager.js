class DataManager {
    constructor(url) {
        this.url = url;
        this.data = [];
        this.headers = [];
    }

    async loadData() {
        try {
            const response = await fetch(this.url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const csvText = await response.text();
            this.parseCSV(csvText);
            return true;
        } catch (error) {
            console.error('Error loading data:', error);
            return false;
        }
    }

    parseCSV(text) {
        const lines = text.trim().split('\n');
        this.headers = lines[0].split(',').map(h => h.trim());
        this.data = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim());
            const row = {};
            this.headers.forEach((header, i) => {
                row[header] = values[i];
            });
            return row;
        });
    }

    getSalesByCategory() {
        const sales = {};
        this.data.forEach(row => {
            const category = row['분류'];
            const amount = parseFloat(row['판매금액']);
            if (sales[category]) {
                sales[category] += amount;
            } else {
                sales[category] = amount;
            }
        });
        return sales;
    }

    getPaginatedData(page = 1, pageSize = 10) {
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        return this.data.slice(start, end);
    }
}
