/**
 * Redacting logger. Application code must use this instead of `console.*`
 * so that OAuth tokens and BYOK AI keys can never reach a log sink
 * (SECURITY.md T3 / non-negotiable 3).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogSink {
  write(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style keys
  /sk-ant-[A-Za-z0-9-]{20,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
];

const SECRET_KEYS = new Set([
  'token',
  'accesstoken',
  'access_token',
  'apikey',
  'api_key',
  'key',
  'authorization',
  'password',
  'secret',
  'code_verifier',
]);

export function redact(input: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '[REDACTED]'), input);
}

function redactContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (SECRET_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class ConsoleSink implements LogSink {
  write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const args: unknown[] = context ? [message, context] : [message];
    switch (level) {
      case 'debug':
        console.debug(...args);
        break;
      case 'info':
        console.info(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
    }
  }
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/**
 * Redaction happens here, in the factory, so every sink — console, telemetry, a
 * test spy — receives already-scrubbed data (SECURITY.md non-negotiable 3).
 */
export function createLogger(sink: LogSink = new ConsoleSink()): Logger {
  const at =
    (level: LogLevel) =>
    (msg: string, ctx?: Record<string, unknown>): void => {
      const safeCtx = redactContext(ctx);
      if (safeCtx) sink.write(level, redact(msg), safeCtx);
      else sink.write(level, redact(msg));
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

export const logger: Logger = createLogger();
