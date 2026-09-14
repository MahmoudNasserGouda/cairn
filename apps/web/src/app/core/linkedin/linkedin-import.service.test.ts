import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LINKEDIN_ARCHIVE_MAX_BYTES } from '@cairn/shared';
import type { LinkedinArchive } from '@cairn/linkedin-archive';
import { LinkedinImportService } from './linkedin-import.service';
import type { LinkedinImportResponse } from './linkedin-worker-protocol';

const workerFactory = vi.hoisted(() => ({ create: vi.fn<() => unknown>() }));
vi.mock('./worker-url', () => ({
  createArchiveWorker: (): unknown => workerFactory.create(),
}));

function archive(overrides: Partial<LinkedinArchive> = {}): LinkedinArchive {
  return {
    positions: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    languages: [],
    emails: [],
    report: { read: [], missing: [], skipped: [] },
    ...overrides,
  };
}

/** A stand-in for the sandboxed archive worker. */
function fakeWorker(reply: LinkedinImportResponse | 'silent' | 'error'): {
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
        // A dedicated worker's messages carry origin '' (see the protocol module).
        for (const cb of listeners.get('message') ?? []) cb({ data: reply, origin: '' });
      });
    },
  };
  return { worker, terminated: () => terminated };
}

/** jsdom's Blob has no `arrayBuffer()`, so build the minimal File the service uses. */
function file(name: string, options: { size?: number; zip?: boolean } = {}): File {
  const size = options.size ?? 64;
  const bytes = new Uint8Array(size);
  if (options.zip !== false) bytes.set([0x50, 0x4b, 0x03, 0x04]);
  return {
    name,
    size,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

function makeService(): LinkedinImportService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(LinkedinImportService);
}

beforeEach(() => {
  vi.restoreAllMocks();
  workerFactory.create.mockReset();
});

describe('gating the file before any of it is read', () => {
  it('rejects an oversized archive without starting a worker', async () => {
    const svc = makeService();
    await svc.import(file('export.zip', { size: LINKEDIN_ARCHIVE_MAX_BYTES + 1 }));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/the limit is/);
    expect(workerFactory.create).not.toHaveBeenCalled();
  });

  it('rejects something that is not a zip, and says what to upload instead', async () => {
    // The most likely wrong file by a mile is the CV the user just dropped on the
    // other control. "Not a zip archive" would be technically true and useless.
    const svc = makeService();
    await svc.import(file('cv.pdf', { zip: false }));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/\.zip/);
    expect(workerFactory.create).not.toHaveBeenCalled();
  });
});

describe('importing', () => {
  it('produces a draft for review rather than committing anything', async () => {
    const { worker, terminated } = fakeWorker({
      id: 1,
      ok: true,
      archive: archive({
        skills: ['Python'],
        report: { read: ['Skills.csv'], missing: [], skipped: ['Connections.csv'] },
      }),
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('export.zip'));

    expect(svc.status()).toBe('review');
    expect(svc.draft()?.archive.skills).toEqual(['Python']);
    expect(svc.draft()?.fileName).toBe('export.zip');
    // The worker is the CPU budget; it does not outlive the import.
    expect(terminated()).toBe(true);
  });

  it('refuses an archive that held none of the files it reads', async () => {
    // A ZIP that parses but is not a LinkedIn export. An empty review form with a
    // "Add to my profile" button under it would be a worse answer than saying so.
    const { worker } = fakeWorker({
      id: 1,
      ok: true,
      archive: archive({
        report: { read: [], missing: ['Profile.csv'], skipped: ['holiday.jpg'] },
      }),
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('holiday-photos.zip'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/LinkedIn/);
    expect(svc.draft()).toBeNull();
  });

  it('surfaces the reader’s own message when the archive is hostile', async () => {
    const { worker } = fakeWorker({
      id: 1,
      ok: false,
      error: 'Skills.csv inflates past the 524288-byte limit',
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('bomb.zip'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/inflates past/);
  });

  it('terminates a worker that never answers, and says so', async () => {
    vi.useFakeTimers();
    const { worker, terminated } = fakeWorker('silent');
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    const pending = svc.import(file('wedged.zip'));
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();

    expect(terminated()).toBe(true);
    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/longer than/);
  });

  it('reports a worker that fails to start', async () => {
    const { worker } = fakeWorker('error');
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('export.zip'));

    expect(svc.status()).toBe('error');
    expect(svc.error()).toMatch(/failed to start/);
  });

  it('reset() puts it back to the empty state', async () => {
    const { worker } = fakeWorker({
      id: 1,
      ok: true,
      archive: archive({
        skills: ['Python'],
        report: { read: ['Skills.csv'], missing: [], skipped: [] },
      }),
    });
    workerFactory.create.mockReturnValue(worker);

    const svc = makeService();
    await svc.import(file('export.zip'));
    svc.reset();

    expect(svc.status()).toBe('idle');
    expect(svc.draft()).toBeNull();
    expect(svc.error()).toBeNull();
  });
});
