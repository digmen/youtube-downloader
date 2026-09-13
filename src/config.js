import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[config] Не задана обязательная переменная окружения: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

function num(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  // Владелец: всегда допущен + получает карточки с запросами доступа (см. access.js).
  ownerId: required('OWNER_ID'),
  adminChatId: process.env.ADMIN_CHAT_ID?.trim() || null,

  ytdlpPath: process.env.YTDLP_PATH?.trim() || 'yt-dlp',
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH?.trim() || 'ffprobe',
  tmpDir: path.resolve(process.env.TMP_DIR?.trim() || './tmp'),

  queueConcurrency: num('QUEUE_CONCURRENCY', 1),
  downloadTimeoutSec: num('DOWNLOAD_TIMEOUT_SEC', 600),
  minFreeDiskMb: num('MIN_FREE_DISK_MB', 2000),
  maxFilesizeMb: num('MAX_FILESIZE_MB', 1900),

  // Локальный Bot API (docker, тот же что у video-cutter) — лимит 2 ГБ вместо 50 МБ.
  telegramApiRoot: process.env.TELEGRAM_API_ROOT?.trim() || null,
};
