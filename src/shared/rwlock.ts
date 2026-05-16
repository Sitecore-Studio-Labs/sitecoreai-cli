/**
 * Async read/write lock.
 *
 * Many concurrent readers OR one exclusive writer. Used by the MCP
 * dispatcher to let read tools (`*_inspect`, `environment_status`, …)
 * run in parallel while still serializing writes against everything.
 *
 * **Writer preference.** Queued writers are admitted before queued
 * readers when a write releases. This is the right default for scai:
 * an agent issuing a steady stream of reads must not starve a queued
 * `recipe_push` waiting to grab the exclusive slot.
 *
 * **Cancellation.** This primitive does not unwind a queued acquire when
 * its caller is cancelled. Callers that care should check their
 * AbortSignal immediately after `withRead`/`withWrite` admits them and
 * bail before doing real work. Holding the lock for the duration of a
 * no-op bail is negligible.
 */

export interface RwLockSnapshot {
  readers: number;
  writerActive: boolean;
  waitingReaders: number;
  waitingWriters: number;
}

export class RwLock {
  private readers = 0;
  private writerActive = false;
  private waitingReaders: Array<() => void> = [];
  private waitingWriters: Array<() => void> = [];

  async withRead<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireRead();
    try {
      return await task();
    } finally {
      this.releaseRead();
    }
  }

  async withWrite<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireWrite();
    try {
      return await task();
    } finally {
      this.releaseWrite();
    }
  }

  private acquireRead(): Promise<void> {
    // Block new readers when a writer is queued so writes don't starve
    // under a steady read load.
    if (!this.writerActive && this.waitingWriters.length === 0) {
      this.readers += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waitingReaders.push(resolve);
    });
  }

  private releaseRead(): void {
    this.readers -= 1;
    if (this.readers === 0 && this.waitingWriters.length > 0) {
      this.writerActive = true;
      const next = this.waitingWriters.shift();
      next?.();
    }
  }

  private acquireWrite(): Promise<void> {
    if (!this.writerActive && this.readers === 0) {
      this.writerActive = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waitingWriters.push(resolve);
    });
  }

  private releaseWrite(): void {
    this.writerActive = false;
    if (this.waitingWriters.length > 0) {
      this.writerActive = true;
      const next = this.waitingWriters.shift();
      next?.();
      return;
    }
    if (this.waitingReaders.length > 0) {
      const waiters = this.waitingReaders.splice(0);
      this.readers += waiters.length;
      for (const w of waiters) w();
    }
  }

  /** Snapshot of internal state — for tests and diagnostics. */
  snapshot(): RwLockSnapshot {
    return {
      readers: this.readers,
      writerActive: this.writerActive,
      waitingReaders: this.waitingReaders.length,
      waitingWriters: this.waitingWriters.length,
    };
  }

  /**
   * Drop all state. Used by tests to ensure no Promise-chain residue
   * carries across `describe` blocks. Production callers don't need this.
   */
  reset(): void {
    this.readers = 0;
    this.writerActive = false;
    this.waitingReaders = [];
    this.waitingWriters = [];
  }
}
