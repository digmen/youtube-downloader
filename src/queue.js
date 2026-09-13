import PQueue from 'p-queue';
import { config } from './config.js';

// Один запрос за раз (сервер общий с боевыми VPN-ботами — экономим память/CPU).
const queue = new PQueue({ concurrency: config.queueConcurrency });

export function enqueueDownload(task) {
  return queue.add(task);
}

export function queuePosition() {
  return queue.size + queue.pending;
}

export async function drainQueue(timeoutMs) {
  await Promise.race([queue.onIdle(), new Promise((r) => setTimeout(r, timeoutMs))]);
}
