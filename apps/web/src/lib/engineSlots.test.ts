import { describe, expect, it } from 'vitest';
import { EngineError } from './engineClient';
import { createSessionRegistry, createSessionSlots } from './engineSlots';

/** Lets every settled promise run its callbacks. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('createSessionSlots', () => {
  it('grants up to the cap at once, then queues', async () => {
    const slots = createSessionSlots(2);
    const never = new AbortController().signal;
    await slots.acquire(never);
    await slots.acquire(never);
    let third = false;
    void slots.acquire(never).then(() => {
      third = true;
    });
    await flush();
    expect(slots.held).toBe(2);
    expect(slots.waiting).toBe(1);
    expect(third).toBe(false);
  });

  it('starts queued waiters in FIFO order as slots are released (7.3)', async () => {
    const slots = createSessionSlots(1);
    const never = new AbortController().signal;
    const releaseFirst = await slots.acquire(never);
    const order: string[] = [];
    const releases: Record<string, () => void> = {};
    for (const name of ['a', 'b', 'c']) {
      void slots.acquire(never).then((release) => {
        order.push(name);
        releases[name] = release;
      });
    }
    await flush();
    expect(order).toEqual([]);
    expect(slots.waiting).toBe(3);

    releaseFirst();
    await flush();
    expect(order).toEqual(['a']);
    releases.a();
    await flush();
    expect(order).toEqual(['a', 'b']);
    releases.b();
    await flush();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(slots.held).toBe(1);
    expect(slots.waiting).toBe(0);
  });

  it('does not let a new caller pass a queued waiter', async () => {
    const slots = createSessionSlots(1);
    const never = new AbortController().signal;
    const release = await slots.acquire(never);
    const order: string[] = [];
    void slots.acquire(never).then(() => order.push('queued'));
    release();
    void slots.acquire(never).then(() => order.push('late'));
    await flush();
    expect(order).toEqual(['queued']);
    expect(slots.waiting).toBe(1);
  });

  it('treats a second release as a no-op', async () => {
    const slots = createSessionSlots(1);
    const never = new AbortController().signal;
    const release = await slots.acquire(never);
    const granted: string[] = [];
    void slots.acquire(never).then(() => granted.push('b'));
    void slots.acquire(never).then(() => granted.push('c'));

    release();
    release();
    await flush();
    expect(granted).toEqual(['b']);
    expect(slots.held).toBe(1);
    expect(slots.waiting).toBe(1);
  });

  it('removes an aborted waiter from the queue and rejects with kind cancelled (7.4)', async () => {
    const slots = createSessionSlots(1);
    const never = new AbortController().signal;
    const release = await slots.acquire(never);

    const controller = new AbortController();
    const aborted = slots.acquire(controller.signal);
    const granted: string[] = [];
    void slots.acquire(never).then(() => granted.push('next'));
    await flush();
    expect(slots.waiting).toBe(2);

    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(EngineError);
    await expect(aborted).rejects.toMatchObject({ kind: 'cancelled' });
    expect(slots.waiting).toBe(1);

    release();
    await flush();
    expect(granted).toEqual(['next']);
    expect(slots.held).toBe(1);
    expect(slots.waiting).toBe(0);
  });

  it('rejects at once with kind cancelled when the signal is already aborted', async () => {
    const slots = createSessionSlots(1);
    const controller = new AbortController();
    controller.abort();
    await expect(slots.acquire(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(slots.held).toBe(0);
    expect(slots.waiting).toBe(0);
  });
});

describe('createSessionRegistry', () => {
  it('keeps ids in insertion order and ignores duplicates and unknown removals', () => {
    const registry = createSessionRegistry();
    registry.add('s1');
    registry.add('s2');
    registry.add('s1');
    registry.remove('unknown');
    expect(registry.ids()).toEqual(['s1', 's2']);
    registry.remove('s1');
    expect(registry.ids()).toEqual(['s2']);
  });
});
