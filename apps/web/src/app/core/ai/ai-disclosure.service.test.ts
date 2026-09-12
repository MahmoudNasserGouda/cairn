import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { BuildPromptInput } from '@cairn/ai';
import { AiDisclosureService } from './ai-disclosure.service';

const CV: BuildPromptInput = {
  task: 'Extract structured facts from a CV',
  userQuestion: 'Read the CV below.',
  docs: [{ label: 'CV text', content: 'Octo Cat\nocto@example.com\nTypeScript' }],
};

function request(input: BuildPromptInput = CV) {
  return {
    feature: 'Re-reading your CV',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    input,
  };
}

let svc: AiDisclosureService;

beforeEach(() => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  svc = TestBed.inject(AiDisclosureService);
});

describe('what will be sent', () => {
  it('strips the email address by default, and puts it back on request', async () => {
    const pending = svc.ask(request());

    expect(svc.containsEmail()).toBe(true);
    expect(svc.payload()?.userPrompt).not.toContain('octo@example.com');
    expect(svc.payload()?.userPrompt).toContain('[email removed]');

    svc.setRedactEmail(false);
    expect(svc.payload()?.userPrompt).toContain('octo@example.com');

    svc.confirm();
    expect((await pending)?.docs[0]?.content).toContain('octo@example.com');
  });

  it('discloses the payload as it will actually be sent, not as it arrived', async () => {
    const pending = svc.ask(request());
    const before = svc.payload()?.includedDocs[0]?.chars ?? 0;

    svc.toggleDoc(0);

    expect(svc.payload()?.includedDocs).toEqual([]);
    expect(before).toBeGreaterThan(0);

    svc.cancel();
    expect(await pending).toBeNull();
  });

  it('treats "everything excluded" as a decline rather than an empty request', async () => {
    const pending = svc.ask(request());
    svc.toggleDoc(0);
    svc.confirm();

    expect(await pending).toBeNull();
  });

  it('resolves with the approved payload on confirm', async () => {
    const pending = svc.ask(request());
    svc.confirm();

    const approved = await pending;
    expect(approved?.task).toBe(CV.task);
    expect(approved?.docs).toHaveLength(1);
    expect(svc.open()).toBe(false);
  });
});

describe('between requests', () => {
  it('starts each request from a clean slate', async () => {
    const first = svc.ask(request());
    svc.toggleDoc(0);
    svc.setRedactEmail(false);
    svc.cancel();
    await first;

    const second = svc.ask(request());
    expect(svc.isIncluded(0)).toBe(true);
    expect(svc.redactEmail()).toBe(true);

    svc.cancel();
    await second;
  });

  it('declines an unanswered request when a new one arrives', async () => {
    const first = svc.ask(request());
    const second = svc.ask(request());

    expect(await first).toBeNull();

    svc.confirm();
    expect(await second).not.toBeNull();
  });

  it('shows no email toggle when there is no address in the payload', () => {
    void svc.ask(
      request({ ...CV, docs: [{ label: 'issue #1', content: 'No address here.' }] }),
    );
    expect(svc.containsEmail()).toBe(false);
    svc.cancel();
  });
});
