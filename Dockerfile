FROM node:18-bullseye

# Install build tools for native deps like better-sqlite3 (only if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Install prod dependencies only
RUN npm ci --omit=dev

# Copy project files
COPY . .

# Environment
ENV NODE_ENV=production \
    PORT=5173

# Expose server port
EXPOSE 5173

# Default DB path can be overridden via env DELIVERY_DB_PATH
CMD ["node", "server.js"]
