// Доступ по запросу: незнакомый человек написал боту → владельцу приходит карточка
// с кнопками «Разрешить»/«Отклонить» → решение сохраняется на диске (переживает рестарт).
// Не открытая регистрация — каждый новый человек утверждается лично, вручную.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const DATA_DIR = path.resolve(config.tmpDir, '..', 'data');
const FILE = path.join(DATA_DIR, 'allowed.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { allowed: [], pending: {} };
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

const state = load();

export function isAllowed(id) {
  return String(id) === config.ownerId || state.allowed.includes(String(id));
}
export function isPending(id) {
  return Boolean(state.pending[String(id)]);
}
export function pendingOf(id) {
  return state.pending[String(id)];
}
export function addPending(id, meta) {
  state.pending[String(id)] = { ...meta, at: Date.now() };
  save();
}
export function approve(id) {
  const s = String(id);
  if (!state.allowed.includes(s)) state.allowed.push(s);
  delete state.pending[s];
  save();
}
export function deny(id) {
  delete state.pending[String(id)];
  save();
}
export function revoke(id) {
  state.allowed = state.allowed.filter((x) => x !== String(id));
  save();
}
export function listAllowed() {
  return state.allowed;
}
