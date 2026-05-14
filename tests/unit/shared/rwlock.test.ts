import { describe, expect, it } from "vitest";
import { RwLock } from "../../../src/shared/rwlock";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const tick = async (count = 1): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await new Promise((res) => setImmediate(res));
  }
};

describe("RwLock", () => {
  it("admits multiple readers concurrently", async () => {
    const lock = new RwLock();
    const gate = defer<void>();
    let peak = 0;
    let inFlight = 0;
    const task = async (): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate.promise;
      inFlight -= 1;
    };

    const a = lock.withRead(task);
    const b = lock.withRead(task);
    const c = lock.withRead(task);
    await tick();

    expect(peak).toBe(3);
    expect(lock.snapshot()).toMatchObject({ readers: 3, writerActive: false });
    gate.resolve();
    await Promise.all([a, b, c]);
    expect(lock.snapshot()).toMatchObject({ readers: 0, waitingReaders: 0 });
  });

  it("blocks writes while readers are active", async () => {
    const lock = new RwLock();
    const readGate = defer<void>();
    const events: string[] = [];

    const r = lock.withRead(async () => {
      events.push("r-start");
      await readGate.promise;
      events.push("r-end");
    });
    await tick();
    const w = lock.withWrite(async () => {
      events.push("w-start");
      events.push("w-end");
    });
    await tick();

    expect(events).toEqual(["r-start"]);
    readGate.resolve();
    await Promise.all([r, w]);
    expect(events).toEqual(["r-start", "r-end", "w-start", "w-end"]);
  });

  it("serializes writes against writes", async () => {
    const lock = new RwLock();
    const gateA = defer<void>();
    let aActive = false;
    let bActive = false;
    let overlap = false;

    const a = lock.withWrite(async () => {
      aActive = true;
      if (bActive) overlap = true;
      await gateA.promise;
      aActive = false;
    });
    const b = lock.withWrite(async () => {
      bActive = true;
      if (aActive) overlap = true;
      bActive = false;
    });
    await tick();

    expect(bActive).toBe(false);
    gateA.resolve();
    await Promise.all([a, b]);
    expect(overlap).toBe(false);
  });

  it("prefers a queued writer over queued readers", async () => {
    const lock = new RwLock();
    const r1Gate = defer<void>();
    const order: string[] = [];

    const r1 = lock.withRead(async () => {
      order.push("r1");
      await r1Gate.promise;
    });
    await tick();
    const w = lock.withWrite(async () => {
      order.push("w");
    });
    await tick();
    const r2 = lock.withRead(async () => {
      order.push("r2");
    });
    await tick();

    expect(order).toEqual(["r1"]);
    r1Gate.resolve();
    await Promise.all([r1, w, r2]);
    expect(order).toEqual(["r1", "w", "r2"]);
  });

  it("wakes all queued readers when a write releases with no pending writer", async () => {
    const lock = new RwLock();
    const wGate = defer<void>();
    const order: string[] = [];

    const w = lock.withWrite(async () => {
      order.push("w");
      await wGate.promise;
    });
    await tick();
    const r1 = lock.withRead(async () => {
      order.push("r1");
    });
    const r2 = lock.withRead(async () => {
      order.push("r2");
    });
    await tick();

    expect(order).toEqual(["w"]);
    wGate.resolve();
    await Promise.all([w, r1, r2]);
    // r1 and r2 run concurrently after w finishes — order between them is
    // not significant, only that both ran and neither blocked the other.
    expect(order.slice(1).sort()).toEqual(["r1", "r2"]);
    expect(lock.snapshot()).toEqual({
      readers: 0,
      writerActive: false,
      waitingReaders: 0,
      waitingWriters: 0,
    });
  });

  it("releases the lock when a task throws", async () => {
    const lock = new RwLock();
    await expect(
      lock.withWrite(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(lock.snapshot()).toMatchObject({ writerActive: false, readers: 0 });

    // Lock is still usable.
    await lock.withWrite(async () => {
      /* no-op */
    });
    await lock.withRead(async () => {
      /* no-op */
    });
  });
});
