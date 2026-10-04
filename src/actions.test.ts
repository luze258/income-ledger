import { describe, expect, it } from 'vitest';
import { createActionGate } from './actions';

describe('action gate', () => {
  it('does not start a second write while the first is pending', async () => {
    const gate = createActionGate();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const first = gate(async () => {
      calls += 1;
      await pending;
    });
    await gate(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
    release();
    await first;
    await gate(() => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });
});
