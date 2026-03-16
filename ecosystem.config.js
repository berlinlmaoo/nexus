module.exports = {
  apps: [{
    name: 'nexus',
    script: 'node_modules/.bin/next',
    args: 'start --hostname 0.0.0.0 --port 3000',
    cwd: '/home/berlin/Projects/pats-app',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
  }]
}
