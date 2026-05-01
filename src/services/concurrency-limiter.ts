/**
 * 文字起こしジョブの同時実行数を絞るためのモジュールスコープ semaphore。
 * Cloud Run の 1インスタンス内で N 本までしか走らないようにし、
 * それ以上は FIFO でキュー待機させる。
 */

const MAX_CONCURRENT_TRANSCRIPTIONS = 3;

let active = 0;
const waitQueue: Array<() => void> = [];

export function activeCount(): number {
  return active;
}

export function isAtCapacity(): boolean {
  return active >= MAX_CONCURRENT_TRANSCRIPTIONS;
}

export function acquireSlot(): Promise<() => void> {
  if (active < MAX_CONCURRENT_TRANSCRIPTIONS) {
    active++;
    return Promise.resolve(release);
  }
  return new Promise<() => void>((resolve) => {
    waitQueue.push(() => {
      active++;
      resolve(release);
    });
  });
}

function release(): void {
  active--;
  const next = waitQueue.shift();
  if (next) next();
}
