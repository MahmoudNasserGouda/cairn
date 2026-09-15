/**
 * Reading a Stack Exchange user reference out of whatever the person pasted
 * (ADR-0035).
 *
 * The user supplies the id and nothing is guessed — no matching a GitHub login against
 * a display name, no "is this you?". Attaching a stranger's reputation to somebody's
 * profile is a failure with no acceptable version, so the only input is one they chose.
 *
 * What they will actually paste is their profile URL, because that is what the address
 * bar holds. A bare id is accepted too, and read as Stack Overflow.
 */

export interface StackExchangeUserRef {
  readonly userId: number;
  /** The API's `site` parameter: `stackoverflow`, `serverfault`, `math`, … */
  readonly site: string;
}

/** Ids are sequential and nowhere near this; the cap stops a mis-paste becoming a query. */
const MAX_USER_ID = 100_000_000;

/**
 * Hosts that are one word rather than `<site>.stackexchange.com`. Stack Exchange grew
 * these before the network had a naming convention, and they are the sites most
 * developers are actually on.
 */
const NAMED_HOSTS: Readonly<Record<string, string>> = {
  'stackoverflow.com': 'stackoverflow',
  'serverfault.com': 'serverfault',
  'superuser.com': 'superuser',
  'askubuntu.com': 'askubuntu',
  'mathoverflow.net': 'mathoverflow',
  'stackapps.com': 'stackapps',
};

function siteFromHost(host: string): string | null {
  const lower = host.toLowerCase().replace(/^www\./, '');
  const named = NAMED_HOSTS[lower];
  if (named !== undefined) return named;
  // `math.stackexchange.com` -> `math`. The API's site key is the subdomain.
  const suffix = '.stackexchange.com';
  if (lower.endsWith(suffix)) {
    const sub = lower.slice(0, -suffix.length);
    return sub.length > 0 && !sub.includes('.') ? sub : null;
  }
  return null;
}

function validId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= MAX_USER_ID ? id : null;
}

/** Returns null for anything that is not unambiguously a user reference. */
export function parseUserRef(input: string): StackExchangeUserRef | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // A bare id. Deliberately assumed to be Stack Overflow rather than rejected: it is
  // the only site most people have an account on, and the URL form covers the rest.
  const bare = validId(trimmed);
  if (bare !== null) return { userId: bare, site: 'stackoverflow' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const site = siteFromHost(url.hostname);
  if (site === null) return null;

  const parts = url.pathname.split('/').filter((p) => p.length > 0);
  if (parts[0] !== 'users') return null;
  const userId = validId(parts[1] ?? '');
  return userId === null ? null : { userId, site };
}
