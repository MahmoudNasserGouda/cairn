import { redact, createLogger, type LogSink, type LogLevel } from './logger';

describe('redact', () => {
  it('masks GitHub and AI tokens in free text', () => {
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toContain(
      '[REDACTED]',
    );
    expect(redact('key sk-abcdefghijklmnopqrstuvwxyz0123')).toContain('[REDACTED]');
    expect(redact('Authorization: Bearer abcdef0123456789abcdef')).toContain(
      '[REDACTED]',
    );
  });
  it('leaves ordinary text untouched', () => {
    expect(redact('fetched 12 repositories')).toBe('fetched 12 repositories');
  });
});

describe('createLogger', () => {
  it('redacts secret-named context keys before they reach the sink', () => {
    const seen: Array<{
      level: LogLevel;
      msg: string;
      ctx: Record<string, unknown> | undefined;
    }> = [];
    const sink: LogSink = {
      write: (level, message, context) =>
        seen.push({ level, msg: message, ctx: context }),
    };
    const log = createLogger(sink);
    log.info('auth ok', { token: 'ghp_secret', repo: 'angular/angular' });
    expect(seen[0]?.ctx).toEqual({ token: '[REDACTED]', repo: 'angular/angular' });
  });
});
