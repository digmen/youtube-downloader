// Запуск: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'youtube-bot',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      restart_delay: 3000,
      kill_timeout: 20000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
