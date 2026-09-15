import { describe, expect, it } from 'vitest';
import { parseUserRef } from './user-ref';

/**
 * The user supplies the id; nothing is guessed (ADR-0035).
 *
 * No matching a GitHub login against a Stack Exchange display name, no "is this you?".
 * Guessing which stranger's reputation to attach to somebody's profile is a failure
 * mode with no acceptable version — so the only input is something the person pasted,
 * and this is the whole of the parsing they should have to think about.
 */

describe('what a person is likely to paste', () => {
  it.each([
    ['https://stackoverflow.com/users/22656/jon-skeet', 22656, 'stackoverflow'],
    ['https://stackoverflow.com/users/22656', 22656, 'stackoverflow'],
    ['http://stackoverflow.com/users/22656/jon-skeet', 22656, 'stackoverflow'],
    ['stackoverflow.com/users/22656/jon-skeet', 22656, 'stackoverflow'],
    [
      '  https://stackoverflow.com/users/22656/jon-skeet?tab=answers  ',
      22656,
      'stackoverflow',
    ],
    ['22656', 22656, 'stackoverflow'],
  ])('reads %s', (input, id, site) => {
    expect(parseUserRef(input)).toEqual({ userId: id, site });
  });

  /**
   * The network is more than Stack Overflow, and a user's id differs per site — the
   * same person is a different number on Server Fault. Reading the host is what stops
   * a Server Fault profile being looked up against Stack Overflow's ids and silently
   * returning somebody else.
   */
  it.each([
    ['https://serverfault.com/users/1/alice', 'serverfault'],
    ['https://superuser.com/users/1/alice', 'superuser'],
    ['https://askubuntu.com/users/1/alice', 'askubuntu'],
    ['https://math.stackexchange.com/users/1/alice', 'math'],
    ['https://dba.stackexchange.com/users/1/alice', 'dba'],
  ])('takes the site from %s', (input, site) => {
    expect(parseUserRef(input)?.site).toBe(site);
  });
});

describe('what it refuses', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['jon-skeet', 'a display name, which is not an id'],
    ['https://stackoverflow.com/questions/22656', 'a question, not a user'],
    ['https://example.com/users/22656', 'not a Stack Exchange host'],
    ['https://stackoverflow.com/users/0/x', 'zero is not a user id'],
    ['-5', 'negative'],
    ['https://stackoverflow.com/users/abc/x', 'non-numeric'],
  ])('refuses %s (%s)', (input) => {
    expect(parseUserRef(input)).toBeNull();
  });

  /**
   * A bare number is read as a Stack Overflow id, so the length cap matters: it stops a
   * paste of something else entirely becoming a request for user 99999999999999.
   */
  it('refuses an implausibly large id', () => {
    expect(parseUserRef('999999999999999999')).toBeNull();
  });
});
