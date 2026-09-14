import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Trusted Types default policy, which exists only in production and therefore
 * has to be tested here or not at all.
 *
 * `installed` and `armed` are module state, so every test re-imports the module.
 */

interface Policy {
  createScriptURL(value: string): string;
}

function stubTrustedTypes(options: { failing?: boolean } = {}): {
  policy: () => Policy | null;
  calls: () => number;
} {
  let policy: Policy | null = null;
  let calls = 0;
  Object.defineProperty(globalThis, 'trustedTypes', {
    configurable: true,
    writable: true,
    value: {
      createPolicy(_name: string, rules: Policy): unknown {
        calls++;
        if (options.failing) throw new Error('policy "default" already exists');
        policy = rules;
        return rules;
      },
    },
  });
  return { policy: () => policy, calls: () => calls };
}

async function load(): Promise<typeof import('./worker-policy')> {
  vi.resetModules();
  return import('./worker-policy');
}

beforeEach(() => {
  delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
});

afterEach(() => {
  delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
});

describe('createWorker', () => {
  it('returns what the construction callback built', async () => {
    const { createWorker } = await load();
    const worker = { id: 'w' } as unknown as Worker;

    expect(createWorker(() => worker)).toBe(worker);
  });

  it('works where Trusted Types does not exist', async () => {
    const { createWorker } = await load();
    const worker = {} as Worker;

    expect(createWorker(() => worker)).toBe(worker);
  });

  it('installs the policy once, however many workers are created', async () => {
    const tt = stubTrustedTypes();
    const { createWorker } = await load();

    createWorker(() => ({}) as Worker);
    createWorker(() => ({}) as Worker);

    expect(tt.calls()).toBe(1);
  });
});

describe('the policy it installs', () => {
  it('permits a same-origin URL only while a worker is being constructed', async () => {
    const tt = stubTrustedTypes();
    const { createWorker } = await load();

    const url = `${location.origin}/chunk.js`;
    let allowedDuring: string | undefined;
    createWorker(() => {
      allowedDuring = tt.policy()?.createScriptURL(url);
      return {} as Worker;
    });

    expect(allowedDuring).toBe(url);
    // Outside that window the same URL is refused, so the policy cannot be reached
    // by any other sink — in this app or in a compromised dependency.
    expect(() => tt.policy()?.createScriptURL(url)).toThrow(/blocked script URL/);
  });

  it('refuses a cross-origin URL even mid-construction', async () => {
    const tt = stubTrustedTypes();
    const { createWorker } = await load();

    expect(() =>
      createWorker(() => {
        tt.policy()?.createScriptURL('https://evil.test/worker.js');
        return {} as Worker;
      }),
    ).toThrow(/blocked script URL/);
  });

  it('disarms even when construction throws', async () => {
    const tt = stubTrustedTypes();
    const { createWorker } = await load();

    expect(() =>
      createWorker(() => {
        throw new Error('bundler dropped the chunk');
      }),
    ).toThrow(/bundler/);
    expect(() => tt.policy()?.createScriptURL(`${location.origin}/x.js`)).toThrow(
      /blocked script URL/,
    );
  });

  /**
   * The reason this module exists at all.
   *
   * A document may hold exactly one policy named `default`. When each worker factory
   * carried its own copy of this code, the second factory's `createPolicy` threw, the
   * *first* factory's policy governed its `new Worker` call, and that policy's `armed`
   * flag — module-local to the first factory — was false. The second worker was
   * blocked, in production only. One module, one flag: arming works for whichever
   * worker is being built.
   */
  it('arms for every caller, not just the one that installed it', async () => {
    const tt = stubTrustedTypes();
    const { createWorker } = await load();

    createWorker(() => ({}) as Worker);

    let secondCaller: string | undefined;
    createWorker(() => {
      secondCaller = tt.policy()?.createScriptURL(`${location.origin}/second.js`);
      return {} as Worker;
    });

    expect(secondCaller).toBe(`${location.origin}/second.js`);
  });

  it('carries on when something else already owns the default policy', async () => {
    // Angular, or a dependency, got there first. Swallowing the throw lets
    // `new Worker` be judged by *that* policy instead of failing every import with
    // an error that names the wrong cause.
    stubTrustedTypes({ failing: true });
    const { createWorker } = await load();
    const worker = {} as Worker;

    expect(createWorker(() => worker)).toBe(worker);
  });
});
