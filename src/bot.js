import fs from 'node:fs';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { extractYouTubeUrl } from './urls.js';
import { enqueueDownload, queuePosition } from './queue.js';
import { cleanupJob, downloadYouTube, hasEnoughDisk } from './downloader.js';
import { UserFacingError } from './errors.js';
import { addPending, approve, deny, isAllowed, isPending, listAllowed, revoke } from './access.js';

export const bot = new Bot(config.botToken, {
  client: config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : undefined,
});

bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

// Доступ по запросу: чужой человек → карточка владельцу с кнопками, никто не заходит
// без явного «да» от него (см. access.js). Не открытая регистрация.
bot.use(async (ctx, next) => {
  const from = ctx.from;
  if (!from) return;
  if (isAllowed(from.id)) return next();
  if (ctx.callbackQuery) return next(); // allow:/deny: разбираются ниже, там своя проверка на владельца

  if (isPending(from.id)) {
    await ctx.reply('⏳ Запрос уже отправлен автору бота — жди подтверждения.');
    return;
  }
  addPending(from.id, { username: from.username, firstName: from.first_name });
  await ctx.reply('📨 Запрос отправлен автору бота. Подтвердит — напишу тебе.');
  const who = from.username ? '@' + from.username : from.first_name || `id ${from.id}`;
  await bot.api
    .sendMessage(config.ownerId, `🆕 Хочет пользоваться YouTube-ботом: ${who} (id ${from.id})`, {
      reply_markup: new InlineKeyboard().text('✅ Разрешить', `allow:${from.id}`).text('🚫 Отклонить', `deny:${from.id}`),
    })
    .catch(() => {});
});

bot.callbackQuery(/^allow:(\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCallbackQuery();
  const id = ctx.match[1];
  approve(id);
  await ctx.answerCallbackQuery({ text: 'Разрешено' });
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ Разрешено`).catch(() => {});
  await bot.api.sendMessage(id, '✅ Доступ открыт! Пришли ссылку на YouTube-видео.').catch(() => {});
});

bot.callbackQuery(/^deny:(\d+)$/, async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerId)) return ctx.answerCallbackQuery();
  const id = ctx.match[1];
  deny(id);
  await ctx.answerCallbackQuery({ text: 'Отклонено' });
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n🚫 Отклонено`).catch(() => {});
  await bot.api.sendMessage(id, '🚫 Доступ не дали.').catch(() => {});
});

// /users — кому разрешено; /revoke <id> — отозвать (только владельцу).
bot.command('users', (ctx) => {
  if (String(ctx.from?.id) !== String(config.ownerId)) return;
  const list = listAllowed();
  ctx.reply(list.length ? '👥 Разрешены:\n' + list.join('\n') : 'Пока никого, кроме тебя.');
});
bot.command('revoke', (ctx) => {
  if (String(ctx.from?.id) !== String(config.ownerId)) return;
  const id = (ctx.match ?? '').trim();
  if (!id) return ctx.reply('/revoke <id>');
  revoke(id);
  ctx.reply(`Отозвано: ${id}`);
});

const WELCOME = [
  '👋 Личный YouTube-загрузчик.',
  '',
  'Пришли ссылку — верну видео файлом. В конце ссылки допиши `audio`, чтобы получить только звук.',
].join('\n');

async function alertAdmin(text) {
  if (!config.adminChatId) return;
  try {
    await bot.api.sendMessage(config.adminChatId, `⚠️ ${text}`);
  } catch (e) {
    console.error('[bot] Не удалось уведомить админа:', e.message);
  }
}

bot.command('start', (ctx) => ctx.reply(WELCOME));
bot.command('help', (ctx) => ctx.reply(WELCOME));
bot.command('ping', (ctx) => ctx.reply('🏓 pong'));

const startedAt = Date.now();
const stats = { ok: 0, fail: 0 };
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d ? `${d}д` : '', h ? `${h}ч` : '', `${m}м`].filter(Boolean).join(' ');
}
bot.command('stats', (ctx) =>
  ctx.reply(`⏱ ${formatUptime(Date.now() - startedAt)}\n✅ ${stats.ok} · ❌ ${stats.fail}\n📋 в очереди: ${queuePosition()}`),
);

function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

bot.on('message:text', async (ctx) => {
  const rawText = ctx.message.text.trim();
  if (rawText.startsWith('/')) return;

  const audioOnly = /\baudio\b/i.test(rawText);
  const result = extractYouTubeUrl(rawText);
  if (!result.ok) {
    const msg = {
      no_url: '🤷 Не вижу здесь ссылки на YouTube.',
      bad_domain: '🤷 Это не похоже на ссылку YouTube.',
      too_long: '📏 Слишком длинная ссылка.',
    }[result.reason];
    await ctx.reply(msg);
    return;
  }

  if (!(await hasEnoughDisk())) {
    await ctx.reply('💾 На сервере кончилось место. Попробуй позже.');
    await alertAdmin('Мало места на диске (youtube-downloader).');
    return;
  }

  const position = queuePosition();
  const status = await ctx.reply(position > 0 ? `⏳ В очереди (${position + 1})…` : '⏳ Скачиваю…');

  let job;
  try {
    job = await enqueueDownload(() => downloadYouTube(result.url, { audioOnly }));

    await ctx.api.editMessageText(status.chat.id, status.message_id, '📤 Отправляю…').catch(() => {});

    if (job.type === 'audio') {
      await ctx.replyWithAudio(new InputFile(job.filePath), { title: job.title, caption: job.title });
    } else {
      const caption = [job.title, job.meta.duration ? `⏱ ${fmtDuration(job.meta.duration)}` : null]
        .filter(Boolean)
        .join('\n');
      await ctx.replyWithVideo(new InputFile(job.filePath), {
        caption,
        width: job.meta.width,
        height: job.meta.height,
        duration: job.meta.duration,
        supports_streaming: true,
      });
    }
    stats.ok++;
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => {});
  } catch (e) {
    stats.fail++;
    const userMessage = e instanceof UserFacingError ? e.userMessage : '😕 Не получилось скачать это видео.';
    await ctx.api.editMessageText(status.chat.id, status.message_id, userMessage).catch(() => ctx.reply(userMessage));
    if (e?.alertAdmin) await alertAdmin(`Ошибка загрузки: ${e.message?.slice(0, 300)}`);
    if (!(e instanceof UserFacingError)) console.error('[bot] Непредвиденная ошибка:', e);
  } finally {
    if (job?.jobDir) await cleanupJob(job.jobDir); // файл всегда удаляем сразу после отправки
  }
});

bot.catch((err) => {
  console.error('[bot] Ошибка обработчика:', err.error);
});
