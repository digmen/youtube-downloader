import { bot } from './bot.js';
import { config } from './config.js';
import { cleanupOrphans } from './downloader.js';
import { drainQueue } from './queue.js';

process.on('unhandledRejection', (reason) => {
  console.error('[index] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[index] uncaughtException:', err);
});

async function main() {
  console.log('[index] Запуск YouTube-бота…');
  console.log(`[index] tmpDir=${config.tmpDir}, concurrency=${config.queueConcurrency}`);

  await cleanupOrphans();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[index] Получен ${signal}, завершаюсь…`);
    try {
      await bot.stop();
      await drainQueue(20000);
    } catch (e) {
      console.error('[index] Ошибка при завершении:', e.message);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`[index] Бот @${info.username} запущен.`),
  });
}

main().catch((err) => {
  console.error('[index] Фатальная ошибка запуска:', err);
  process.exit(1);
});
