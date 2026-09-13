// Преобразование ошибок yt-dlp в понятные пользователю сообщения.

export class UserFacingError extends Error {
  constructor(userMessage, opts = {}) {
    super(userMessage);
    this.name = 'UserFacingError';
    this.userMessage = userMessage;
    this.alertAdmin = Boolean(opts.alertAdmin);
  }
}

const RULES = [
  {
    test: /private|only friends|login required|log in|sign in|members-only/i,
    message: '🔒 Видео приватное, для участников канала или требует входа — скачать не получится.',
  },
  {
    test: /video (is )?unavailable|not (be )?found|removed|deleted|does not exist|404/i,
    message: '❌ Видео недоступно или было удалено.',
  },
  {
    test: /geo|not available in your (country|region)|blocked in your/i,
    message: '🌍 Видео недоступно в регионе, где расположен сервер.',
  },
  {
    test: /age.?restrict|sign in to confirm your age/i,
    message: '🔞 Видео с возрастным ограничением — YouTube требует вход в аккаунт, боту это недоступно.',
  },
  {
    test: /file is larger than max-filesize|max-filesize|larger than/i,
    message: '📦 Видео больше лимита — слишком длинное или в высоком разрешении.',
  },
  {
    test: /captcha|rate.?limit|too many requests|429/i,
    message: '⏳ YouTube временно ограничил загрузки с этого сервера. Попробуйте через несколько минут.',
    alertAdmin: true,
  },
  {
    test: /live event|is live|premieres in/i,
    message: '📡 Это трансляция/премьера — скачать можно только после её окончания.',
  },
  {
    test: /Unsupported URL|is not a valid URL|Unable to extract/i,
    message: '🤷 Не удалось распознать это как YouTube-видео.',
  },
];

export function mapYtDlpError(stderr) {
  const text = String(stderr || '');
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return new UserFacingError(rule.message, { alertAdmin: rule.alertAdmin });
    }
  }
  return new UserFacingError('😕 Не удалось скачать это видео. Попробуйте другую ссылку.');
}
