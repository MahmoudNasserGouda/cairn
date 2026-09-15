import { GitlabClient, GitlabError } from './client';

/**
 * The signed-in user's GitLab profile, in one GraphQL request (ADR-0034).
 *
 * The REST route would have been a project list followed by a `/languages` call per
 * project — precisely the fan-out ADR-0030 removed from the GitHub integration, where
 * fifteen repositories cost sixteen requests. This is one POST, and it returns strictly
 * more than the REST pair would.
 *
 * Every field is read defensively. A partial response is normal rather than
 * exceptional: `statistics` needs Reporter access, and a project where the user is only
 * a Guest returns `null` for it.
 */

/** Projects read per import. Beyond this, a profile is not becoming more accurate. */
const PROJECT_LIMIT = 50;
const GROUP_LIMIT = 20;

const VIEWER_QUERY = `
query CairnGitlabViewer($projects: Int!, $groups: Int!) {
  currentUser {
    username
    name
    webUrl
    avatarUrl
    publicEmail
    projectCount
    groupCount
    groupMemberships(first: $groups) {
      nodes { group { fullPath name } }
    }
    projectMemberships(first: $projects) {
      nodes {
        project {
          fullPath
          name
          description
          webUrl
          visibility
          archived
          isForked
          lastActivityAt
          topics
          starCount
          statistics { repositorySize }
          languages { name share }
        }
      }
    }
  }
}`;

export interface GitlabLanguageShare {
  readonly name: string;
  /** A percentage of the repository, already normalised by GitLab. */
  readonly share: number;
}

export interface GitlabProject {
  readonly fullPath: string;
  readonly name: string;
  readonly description: string | null;
  readonly webUrl: string;
  readonly visibility: string;
  readonly lastActivityAt: string | null;
  readonly topics: readonly string[];
  readonly starCount: number;
  /**
   * Bytes, or `null` when the user's access does not include statistics.
   *
   * **Null is not zero**, and the distinction carries weight downstream: GitLab reports
   * language *shares*, so size is the only thing that says whether an 80% Ruby project
   * is a weekend script or a decade of work. Recording an unknown as 0 would silently
   * drop the project from the weighting rather than flagging that it cannot be weighed.
   */
  readonly repositorySize: number | null;
  readonly languages: readonly GitlabLanguageShare[];
}

export interface GitlabViewerGraph {
  readonly username: string;
  readonly name: string | null;
  readonly webUrl: string | null;
  readonly avatarUrl: string | null;
  readonly publicEmail: string | null;
  readonly projectCount: number;
  readonly groupCount: number;
  readonly groups: readonly string[];
  readonly projects: readonly GitlabProject[];
}

interface RawProject {
  fullPath?: string | null;
  name?: string | null;
  description?: string | null;
  webUrl?: string | null;
  visibility?: string | null;
  archived?: boolean | null;
  isForked?: boolean | null;
  lastActivityAt?: string | null;
  topics?: readonly (string | null)[] | null;
  starCount?: number | null;
  statistics?: { repositorySize?: number | null } | null;
  languages?: readonly { name?: string | null; share?: number | null }[] | null;
}

interface RawViewer {
  username?: string | null;
  name?: string | null;
  webUrl?: string | null;
  avatarUrl?: string | null;
  publicEmail?: string | null;
  projectCount?: number | null;
  groupCount?: number | null;
  groupMemberships?: {
    nodes?: readonly ({ group?: { name?: string | null } | null } | null)[] | null;
  } | null;
  projectMemberships?: {
    nodes?: readonly ({ project?: RawProject | null } | null)[] | null;
  } | null;
}

export async function collectGitlabViewer(
  client: GitlabClient,
): Promise<GitlabViewerGraph> {
  const data = await client.query<{ currentUser?: RawViewer | null }>(VIEWER_QUERY, {
    projects: PROJECT_LIMIT,
    groups: GROUP_LIMIT,
  });

  const viewer = data.currentUser;
  if (!viewer || typeof viewer.username !== 'string' || viewer.username.length === 0) {
    // The token is valid enough to reach GraphQL but resolves to nobody — an expired or
    // revoked grant, which must not read as "a user with no projects".
    throw new GitlabError('not signed in to GitLab, or the connection has expired');
  }

  return {
    username: viewer.username,
    name: viewer.name ?? null,
    webUrl: viewer.webUrl ?? null,
    avatarUrl: viewer.avatarUrl ?? null,
    publicEmail: viewer.publicEmail ?? null,
    projectCount: viewer.projectCount ?? 0,
    groupCount: viewer.groupCount ?? 0,
    groups: (viewer.groupMemberships?.nodes ?? [])
      .map((node) => node?.group?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
    projects: (viewer.projectMemberships?.nodes ?? [])
      .map((node) => node?.project)
      .filter((p): p is RawProject => !!p)
      // A fork's code is someone else's; counting its languages would credit the user
      // with every byte of whatever they forked. The GitHub query says `isFork: false`
      // for the same reason, but GitLab's membership connection takes no such filter.
      .filter((p) => p.isForked !== true && p.archived !== true)
      .map(toProject)
      .filter((p): p is GitlabProject => p !== null),
  };
}

function toProject(raw: RawProject): GitlabProject | null {
  if (typeof raw.fullPath !== 'string' || raw.fullPath.length === 0) return null;
  const size = raw.statistics?.repositorySize;
  return {
    fullPath: raw.fullPath,
    name: raw.name ?? raw.fullPath,
    description: raw.description ?? null,
    webUrl: raw.webUrl ?? `https://gitlab.com/${raw.fullPath}`,
    visibility: raw.visibility ?? 'private',
    lastActivityAt: raw.lastActivityAt ?? null,
    topics: (raw.topics ?? []).filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    ),
    starCount: raw.starCount ?? 0,
    repositorySize: typeof size === 'number' && size > 0 ? size : null,
    languages: (raw.languages ?? [])
      .map((l) => ({ name: l?.name ?? '', share: l?.share ?? 0 }))
      .filter((l) => l.name.length > 0 && l.share > 0),
  };
}
