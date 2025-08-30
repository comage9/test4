module.exports = {
  apps: [
    {
      name: 'delivery-dashboard',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Optional: override to a fixed path
        // DELIVERY_DB_PATH: '/var/lib/delivery-dashboard/production.db'
      }
    }
  ]
}

