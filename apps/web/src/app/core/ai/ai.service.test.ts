import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { BuildPromptInput } from '@cairn/ai';
import { AiDisclosureService } from './ai-disclosure.service';
import { AiService } from './ai.service';
import { AiSettingsService } from './ai-settings.service';

const PROMPT: BuildPromptInput = {
  task: 'Explain an issue',
  userQuestion: 'What does this want?',
  docs: [{ label: 'issue #1', content: 'Something is broken.' }],
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The request body as our providers always build it: a JSON string. */
function bodyOf(init: RequestInit): string {
  return typeof init.body === 'string' ? init.body : '';
}

function setup(key: string | null = 'sk-test-key-value') {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AiSettingsService,
        useValue: {
          peekKey: () => key,
          provider: signal('openai'),
          model: signal('gpt-4o-mini'),
        },
      },
    ],
  });
  return {
    fetchMock,
    ai: TestBed.inject(AiService),
    disclosure: TestBed.inject(AiDisclosureService),
  };
}

beforeEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

describe('consent gate', () => {
  it('sends nothing when the user declines', async () => {
    const { ai, disclosure, fetchMock } = setup();

    const outcome = ai.run('Explaining issue #1', PROMPT);
    await Promise.resolve();
    expect(disclosure.open()).toBe(true);
    disclosure.cancel();

    expect(await outcome).toEqual({ status: 'declined' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing when there is no key, and says why', async () => {
    const { ai, fetchMock } = setup(null);

    const outcome = await ai.run('Explaining issue #1', PROMPT);

    expect(outcome).toEqual({
      status: 'error',
      message: 'add an API key on the settings page first',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends exactly what the panel approved, with the key only in a header', async () => {
    const { ai, disclosure, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      reply({ choices: [{ message: { content: ' Here you go. ' } }] }),
    );

    const outcome = ai.run('Explaining issue #1', PROMPT);
    await Promise.resolve();
    disclosure.confirm();

    expect(await outcome).toEqual({ status: 'ok', text: 'Here you go.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).not.toContain('sk-test-key-value');
    expect(bodyOf(init)).not.toContain('sk-test-key-value');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test-key-value',
    );
    expect(bodyOf(init)).toContain('Something is broken.');
  });

  it('honours a document the user excluded in the panel', async () => {
    const { ai, disclosure, fetchMock } = setup();
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'ok' } }] }));

    const outcome = ai.run('Explaining issue #1', {
      ...PROMPT,
      docs: [
        { label: 'keep', content: 'included text' },
        { label: 'drop', content: 'excluded text' },
      ],
    });
    await Promise.resolve();
    disclosure.toggleDoc(1);
    disclosure.confirm();
    await outcome;

    const body = bodyOf((fetchMock.mock.calls[0] as [string, RequestInit])[1]);
    expect(body).toContain('included text');
    expect(body).not.toContain('excluded text');
  });
});

describe('provider failures', () => {
  it('turns a rejected key into an instruction, not a stack trace', async () => {
    const { ai, disclosure, fetchMock } = setup();
    fetchMock.mockResolvedValue(reply({ error: 'nope' }, 401));

    const outcome = ai.run('Explaining issue #1', PROMPT);
    await Promise.resolve();
    disclosure.confirm();

    expect(await outcome).toEqual({
      status: 'error',
      message: 'your provider rejected that API key — check it on the settings page',
    });
  });

  it('names rate limiting as the provider’s, not ours', async () => {
    const { ai, disclosure, fetchMock } = setup();
    fetchMock.mockResolvedValue(reply({}, 429));

    const pending = ai.run('Explaining issue #1', PROMPT);
    await Promise.resolve();
    disclosure.confirm();

    const outcome = await pending;
    expect(outcome.status).toBe('error');
    if (outcome.status !== 'error') return;
    expect(outcome.message).toMatch(/rate-limiting/);
  });

  it('reports an empty completion rather than pretending it worked', async () => {
    const { ai, disclosure, fetchMock } = setup();
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: '   ' } }] }));

    const outcome = ai.run('Explaining issue #1', PROMPT);
    await Promise.resolve();
    disclosure.confirm();

    expect(await outcome).toEqual({
      status: 'error',
      message: 'your provider returned an empty response',
    });
  });
});
