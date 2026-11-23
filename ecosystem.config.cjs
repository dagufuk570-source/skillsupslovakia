// PM2 process file used on the Hetzner server (/srv/slovakiaskills, runs as the "app" user).
// Start: pm2 start ecosystem.config.cjs && pm2 save   Update: deploy slovakiaskills
module.exports = {
  apps: [{
    name: 'slovakiaskills',
    script: 'app.js',
    cwd: '/srv/slovakiaskills',
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' }
  }]
};
