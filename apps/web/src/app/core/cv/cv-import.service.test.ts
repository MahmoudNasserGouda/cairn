import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CV_MAX_BYTES } from '@cairn/shared';
import { CvImportService } from './cv-import.service';
import type { CvExtractResponse } from './cv-worker-protocol';

const workerFactory = vi.hoisted(() => ({ create: vi.fn<() => unknown>() }));
vi.mock('./worker-url', () => ({
  createExtractionWorker: (): unknown => workerFactory.create(),
}));

/**
 * A stand-in for the sandboxed extraction worker. `reply` decides what it posts
 * back — or nothing at all, to exercise the timeout.
 */
function fakeWorker(reply: CvExtractResponse | 'silent' | 'error'): {
  worker: unknown;
  terminated: () => boolean;
} {
  let terminated = false;
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const worker = {
    addEventListener(type: string, cb: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    terminate() {
      terminated = true;
    },
    postMessage() {
      queueMicrotask(() => {
        if (reply === 'silent') return;
        if (reply === 'error') {
          for (const cb of listeners.get('error') ?? []) cb({});
          return;
        }
        // The real worker's messages carry origin '' (see cv-worker-protocol).
        for (const cb of listeners.get('message') ?? []) cb({ data: reply, origin: '' });
      });
    },
  };
  return { worker, terminated: () => terminated };
}

/** jsdom's Blob has no `arrayBuffer()`, so build the minimal File the service uses. */
function file(name: string, size = 10): File {
  const bytes = new ArrayBuffer(size);
  return {
    name,
    size,
    arrayBuffer: async () => bytes,
  } as unknown as File;
}

function makeService(): CvImportService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(CvImportService);
}

beforeEach(() => {
  vi.restoreAllMocks();
  workerFactory.create.mockReset();
});

describe('CV import gating', () => {
  it('rejects a file over the size limit without starting a worker', async () => {
    const svc = makeService();
    await svc.import(file('big.pdf', CV_MAX_BYTES + 1));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/the limit is/);
    expect(workerFactory.create).not.toHaveBeenCalled();
  });

  it('produces a draft for review rather than committing anything', async () => {
    const { worker } = fakeWorker({
      id: 1,
      ok: true,
      kind: 'text',
      text: 'Skills: TypeScript, Docker',
      truncated: false,
      empty: false,
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('cv.txt'));

    expect(svc.error()).toBeNull();
    expect(svc.status()).toBe('review');
    expect(svc.draft()?.fileName).toBe('cv.txt');
    expect(svc.draft()?.parsed.skills).toEqual(
      expect.arrayContaining(['typescript', 'docker']),
    );
  });

  it('explains a scanned PDF instead of failing generically', async () => {
    const { worker } = fakeWorker({
      id: 1,
      ok: true,
      kind: 'pdf',
      text: '',
      truncated: false,
      empty: true,
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('scan.pdf'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/scanned PDF/);
  });

  it('surfaces a worker failure as its message', async () => {
    const { worker } = fakeWorker({ id: 1, ok: false, error: 'that file is corrupt' });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('bad.docx'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toBe('that file is corrupt');
  });

  it('reports a worker that will not start', async () => {
    const { worker } = fakeWorker('error');
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('x.txt'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/failed to start/);
  });

  it('terminates the worker on success — that termination is the CPU budget', async () => {
    const { worker, terminated } = fakeWorker({
      id: 1,
      ok: true,
      kind: 'text',
      text: 'hi',
      truncated: false,
      empty: false,
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('x.txt'));

    expect(terminated()).toBe(true);
  });

  it('times out and terminates a worker that never answers', async () => {
    vi.useFakeTimers();
    const { worker, terminated } = fakeWorker('silent');
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    const done = svc.import(file('spin.pdf'));
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    expect(terminated()).toBe(true);
    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/took longer than/);
  });

  it('reset() clears a draft and its error', async () => {
    const { worker } = fakeWorker({
      id: 1,
      ok: true,
      kind: 'text',
      text: 'hi',
      truncated: false,
      empty: false,
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('x.txt'));
    svc.reset();

    expect(svc.draft()).toBeNull();
    expect(svc.error()).toBeNull();
    expect(svc.status()).toBe('idle');
  });
});
