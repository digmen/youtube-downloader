// Валидация и извлечение YouTube-ссылок из текста сообщения.

const MAX_URL_LENGTH = 500;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const URL_REGEX = /https?:\/\/[^\s]+/i;

/**
 * @param {string} text
 * @returns {{ ok: true, url: string } | { ok: false, reason: 'no_url' | 'bad_domain' | 'too_long' }}
 */
export function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string') {
    return { ok: false, reason: 'no_url' };
  }

  const match = text.match(URL_REGEX);
  if (!match) {
    return { ok: false, reason: 'no_url' };
  }

  let raw = match[0].replace(/[)\]}>,.'"]+$/, '');

  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'no_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'no_url' };
  }

  const host = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_HOSTS.has(host) || host.endsWith('.youtube.com');
  if (!isAllowed) {
    return { ok: false, reason: 'bad_domain' };
  }

  return { ok: true, url: parsed.toString() };
}
