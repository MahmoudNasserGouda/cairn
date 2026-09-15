import { describe, expect, it, vi } from 'vitest';
import { GitlabClient } from './client';
import { collectGitlabViewer } from './viewer-graph';

/**
 * One request per import (ADR-0034), for the reason ADR-0030 gives: the GitHub
 * integration once spent sixteen REST calls to learn what one GraphQL query returns,
 * and GitLab's REST API would have cost exactly the same shape — a project list, then a
 * `/languages` call per project.
 */

const graph = (currentUser: unknown) =>
  new Response(JSON.stringify({ data: { currentUser } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const project = (over: Record<string, unknown> = {}) => ({
  fullPath: 'amara/api',
  name: 'api',
  description: 'the api',
  webUrl: 'https://gitlab.com/amara/api',
  visibility: 'private',
  archived: false,
  isForked: false,
  lastActivityAt: '2026-09-01T00:00:00Z',
  topics: ['ruby'],
  starCount: 3,
  statistics: { repositorySize: 1_000_000 },
  languages: [{ name: 'Ruby', share: 80 }],
  ...over,
});

const viewer = (projects: unknown[], over: Record<string, unknown> = {}) => ({
  username: 'amara',
  name: 'Amara Okonkwo',
  webUrl: 'https://gitlab.com/amara',
  avatarUrl: 'https://gitlab.com/avatar.png',
  publicEmail: 'amara@example.test',
  projectCount: projects.length,
  groupCount: 1,
  groupMemberships: { nodes: [{ group: { fullPath: 'acme', name: 'Acme' } }] },
  projectMemberships: { nodes: projects.map((p) => ({ project: p })) },
  ...over,
});

const clientReturning = (body: unknown) =>
  new GitlabClient({
    token: 't',
    fetchImpl: async () => graph(body),
  });

describe('collectGitlabViewer', () => {
  it('reads the whole profile in a single request', async () => {
    const fetchImpl = vi.fn(async () => graph(viewer([project()])));
    const client = new GitlabClient({
      token: 't',
      fetchImpl,
    });

    await collectGitlabViewer(client);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('flattens memberships into projects with their languages', async () => {
    const result = await collectGitlabViewer(clientReturning(viewer([project()])));

    expect(result.username).toBe('amara');
    expect(result.groups).toEqual(['Acme']);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.languages).toEqual([{ name: 'Ruby', share: 80 }]);
    expect(result.projects[0]?.repositorySize).toBe(1_000_000);
  });

  /**
   * A fork's code is somebody else's. Counting its languages would credit a user with
   * every byte of whatever they forked — the same reason the GitHub query passes
   * `isFork: false`. GitLab's membership connection has no such filter, so it is done
   * here.
   */
  it('excludes forks and archived projects', async () => {
    const result = await collectGitlabViewer(
      clientReturning(
        viewer([
          project({ fullPath: 'amara/own' }),
          project({ fullPath: 'amara/forked', isForked: true }),
          project({ fullPath: 'amara/old', archived: true }),
        ]),
      ),
    );
    expect(result.projects.map((p) => p.fullPath)).toEqual(['amara/own']);
  });

  /**
   * `statistics` needs Reporter access, so a project where the user is only a Guest
   * returns null. That is a missing measurement, not a zero — recording it as 0 would
   * quietly delete the project's languages from the weighting.
   */
  it('keeps a project whose size it cannot see, with the size unknown', async () => {
    const result = await collectGitlabViewer(
      clientReturning(viewer([project({ statistics: null })])),
    );
    expect(result.projects[0]?.repositorySize).toBeNull();
    expect(result.projects[0]?.languages).toHaveLength(1);
  });

  it('survives a sparse response rather than throwing', async () => {
    // Partial data is normal: fields behind scopes we did not ask for come back null.
    const result = await collectGitlabViewer(
      clientReturning({
        username: 'amara',
        name: null,
        webUrl: null,
        avatarUrl: null,
        publicEmail: null,
        projectCount: null,
        groupCount: null,
        groupMemberships: null,
        projectMemberships: { nodes: [{ project: null }, null] },
      }),
    );
    expect(result.username).toBe('amara');
    expect(result.projects).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  it('fails clearly when there is no signed-in user', async () => {
    await expect(collectGitlabViewer(clientReturning(null))).rejects.toThrow(
      /not signed in|no GitLab/i,
    );
  });
});
