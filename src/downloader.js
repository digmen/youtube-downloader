import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { mapYtDlpError, UserFacingError } from './errors.js';

// Низкий приоритет CPU/диска: сервер общий с боевыми VPN-ботами, им приоритет важнее.
function run(bin, args, { timeoutMs, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'nice',
      ['-n', '15', 'ionice', '-c', '3', bin, ...args],
      { timeout: timeoutMs, maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({ error, stdout: stdout || '', stderr: stderr || '', killed: Boolean(error && error.killed) });
      },
    );
  });
}

async function findFile(jobDir, extRegex) {
  const entries = await fs.readdir(jobDir);
  const found = entries.find((f) => extRegex.test(f));
  return found ? path.join(jobDir, found) : null;
}

async function probeVideo(filePath) {
  const args = ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', filePath];
  const { error, stdout } = await run(config.ffprobePath, args, { timeoutMs: 30_000 });
  if (error) return {};
  try {
    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video') || {};
    const hasAudio = streams.some((s) => s.codec_type === 'audio');
    const duration = data.format?.duration ? Math.round(Number(data.format.duration)) : undefined;
    return {
      width: video.width || undefined,
      height: video.height || undefined,
      duration: Number.isFinite(duration) ? duration : undefined,
      hasAudio,
    };
  } catch {
    return {};
  }
}

async function readTitleFromInfoJson(jobDir) {
  try {
    const raw = await fs.readFile(path.join(jobDir, 'media.info.json'), 'utf8');
    const info = JSON.parse(raw);
    const title = (info.title || info.fulltitle || '').trim();
    return title ? title.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Скачивает YouTube-видео. `audioOnly` — вернуть только звук (mp3).
 * @param {string} url
 * @param {{ audioOnly?: boolean }} [opts]
 */
export async function downloadYouTube(url, opts = {}) {
  const jobDir = path.join(config.tmpDir, randomUUID());
  await fs.mkdir(jobDir, { recursive: true });

  const outputTemplate = path.join(jobDir, 'media.%(ext)s');
  const common = [
    '--max-filesize', `${config.maxFilesizeMb}M`,
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout', '30',
    '--retries', '3',
    '-o', outputTemplate,
    '--write-info-json',
  ];

  const args = opts.audioOnly
    ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '2', ...common, '--', url]
    : [
        // Лучшее качество, укладывающееся в лимит; предпочитаем h264+mp4, чтобы Telegram
        // показывал превью и проигрывал видео сразу, не требуя перекодирования на клиенте.
        '-f', `bv*[filesize<${config.maxFilesizeMb}M][ext=mp4]+ba[ext=m4a]/b[filesize<${config.maxFilesizeMb}M]/bv*+ba/b`,
        '-S', 'res,ext:mp4:m4a',
        '--merge-output-format', 'mp4',
        ...common,
        '--', url,
      ];

  const { error, stderr } = await run(config.ytdlpPath, args, { timeoutMs: config.downloadTimeoutSec * 1000 });

  if (error) {
    await cleanupJob(jobDir);
    if (error.killed || error.signal === 'SIGTERM') {
      throw new UserFacingError('⏱️ Скачивание заняло слишком много времени и было прервано.');
    }
    if (error.code === 'ENOENT') {
      console.error('[downloader] yt-dlp не найден по пути:', config.ytdlpPath);
      throw new UserFacingError('🔧 Технические неполадки на сервере. Попробуйте позже.', { alertAdmin: true });
    }
    console.error('[downloader] yt-dlp stderr:', stderr.slice(0, 2000));
    throw mapYtDlpError(stderr);
  }

  const title = await readTitleFromInfoJson(jobDir);

  if (opts.audioOnly) {
    const filePath = await findFile(jobDir, /\.mp3$/i);
    if (!filePath) {
      await cleanupJob(jobDir);
      throw mapYtDlpError(stderr || 'no audio');
    }
    return { type: 'audio', filePath, jobDir, title };
  }

  const filePath = await findFile(jobDir, /\.(mp4|mov|webm|mkv)$/i);
  if (!filePath) {
    await cleanupJob(jobDir);
    console.error('[downloader] Файл не найден после загрузки. stderr:', stderr.slice(0, 1000));
    throw mapYtDlpError(stderr || 'no video formats');
  }
  const meta = await probeVideo(filePath);
  return { type: 'video', filePath, jobDir, meta, title };
}

export async function cleanupJob(jobDir) {
  if (!jobDir) return;
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch (e) {
    console.error('[downloader] Не удалось удалить', jobDir, e.message);
  }
}

export async function hasEnoughDisk() {
  try {
    const stats = await fs.statfs(config.tmpDir);
    const freeMb = (stats.bsize * stats.bavail) / (1024 * 1024);
    return freeMb >= config.minFreeDiskMb;
  } catch (e) {
    console.error('[downloader] statfs недоступен:', e.message);
    return true;
  }
}

export async function cleanupOrphans() {
  try {
    await fs.mkdir(config.tmpDir, { recursive: true });
    const entries = await fs.readdir(config.tmpDir, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await cleanupJob(path.join(config.tmpDir, entry.name));
        removed++;
      }
    }
    if (removed > 0) console.log(`[downloader] Очищено осиротевших папок: ${removed}`);
  } catch (e) {
    console.error('[downloader] Ошибка очистки tmp:', e.message);
  }
}
