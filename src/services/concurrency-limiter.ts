/**
 * 文字起こしジョブの同時実行数を絞るためのモジュールスコープ semaphore。
 * Cloud Run の 1インスタンス内で N 本までしか走らないようにし、
 * それ以上は FIFO でキュー待機させる。
 *
 * SIGTERM 受信時は draining モードに入り、新規 acquire を拒否しつつ
 * 既存ジョブの完了を最大 SHUTDOWN_GRACE_MS 待つ。
 */

import config from "../core/config.ts";

const MAX_CONCURRENT_TRANSCRIPTIONS = Math.max(
  1,
  config.maxConcurrentTranscriptions,
);
const SHUTDOWN_GRACE_MS = 9 * 60 * 1000; // 9分。Cloud Run の SIGKILL までに余裕を残す。
const SHUTDOWN_POLL_MS = 500;

let active = 0;
const waitQueue: Array<() => void> = [];
let draining = false;

export class ShuttingDownError extends Error {
  constructor() {
    super("Server is shutting down; not accepting new transcription jobs.");
    this.name = "ShuttingDownError";
  }
}

export function activeCount(): number {
  return active;
}

export function isAtCapacity(): boolean {
  return active >= MAX_CONCURRENT_TRANSCRIPTIONS;
}

export function isDraining(): boolean {
  return draining;
}

export function acquireSlot(): Promise<() => void> {
  if (draining) {
    return Promise.reject(new ShuttingDownError());
  }
  if (active < MAX_CONCURRENT_TRANSCRIPTIONS) {
    active++;
    return Promise.resolve(release);
  }
  return new Promise<() => void>((resolve, reject) => {
    waitQueue.push(() => {
      if (draining) {
        reject(new ShuttingDownError());
        return;
      }
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

let shutdownInstalled = false;

/**
 * SIGTERM/SIGINT を受けたら draining に切り替え、active が 0 になるか
 * grace 期限を迎えるまで Deno.exit を遅延させる。
 */
export function installGracefulShutdown(): void {
  if (shutdownInstalled) return;
  shutdownInstalled = true;

  const handler = (signal: string) => async () => {
    if (draining) return;
    draining = true;
    console.log(
      `[shutdown] ${signal} received; draining (active=${active}, queued=${waitQueue.length}). Grace=${SHUTDOWN_GRACE_MS}ms`,
    );

    // 待機中の acquirer を全部 ShuttingDownError で起こす
    while (waitQueue.length > 0) {
      const next = waitQueue.shift();
      if (next) next();
    }

    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    while (active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS));
    }

    if (active > 0) {
      console.warn(
        `[shutdown] grace expired with active=${active}; exiting anyway.`,
      );
    } else {
      console.log("[shutdown] all jobs drained; exiting cleanly.");
    }
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGTERM", handler("SIGTERM"));
  Deno.addSignalListener("SIGINT", handler("SIGINT"));
}
