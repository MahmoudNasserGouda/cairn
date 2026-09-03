# 0025. Multi-provider identity; GitHub is the only data connection

- Status: Accepted
- Date: 2026-09-02
- Deciders: Project owner
- Builds on: [ADR-0012](0012-linkedin-as-oauth-identity-only.md),
  [ADR-0020](0020-oauth-token-and-byok-key-handling.md),
  [ADR-0024](0024-github-oauth-token-exchange-function.md)

## Context

Users asked to "sign in with GitHub, LinkedIn, Wuzzuf, Indeed, Gulf Talent, …" and
have Cairn pull their profile, repositories, and job history from each. Most of that
is not possible:

- **LinkedIn** — "Sign In with LinkedIn (OpenID Connect)" returns `name`, `email`,
  `picture` and nothing else. The profile/positions/skills/connections APIs were
  withdrawn between 2015 and 2023. There is no supported way to read a member's work
  history.
- **Google** — identity only; there is no "jobs" concept.
- **Indeed** — the API is a partner/employer product (ATS, job posting). No
  job-seeker endpoint returns your profile or applications.
- **Wuzzuf, Gulf Talent, Bayt, Naukri, …** — no public API and no OAuth at all.

The only way to get a user's data out of a site with no API is to drive it with the
user's password. That is prohibited by
[SECURITY.md](../../SECURITY.md) §5 and the assistant's own operating rules, breaks
every one of those sites' Terms of Service, and would make Cairn a store of every
user's credentials — the worst possible breach target.

## Decision

Split the concerns.

### Identity providers — GitHub, LinkedIn, Google

- One pluggable OAuth layer (`libs/auth`, framework-free for ADR-0014). Each provider
  is a config record; the flow (`authorize` redirect → single-use `state` →
  `code -> token` via the `cairn-auth` Worker → `userinfo`) is shared.
- **GitHub is the only data connection.** Its token is retained for the session and
  used to read repositories ([ADR-0006](0006-direct-github-api-usage.md)).
- **LinkedIn and Google are identity only** — name, email, avatar. Their access
  tokens are discarded immediately after the one `userinfo` call; nothing else is
  ever requested with them. Scopes are exactly `openid profile email`.
- A provider with no client ID configured is hidden in the UI and returns
  `501 provider_not_configured` from the Worker. GitHub-only is a valid deployment.

### Profile data — not from identity providers

Skills, work history, and education come from, in order of trust:

1. **CV / résumé upload** — the user's own file, parsed on-device
   ([ADR-0011](0011-local-first-cv-processing.md)). This is the primary source and
   the answer to "import my LinkedIn".
2. **Manual entry / paste** — treated as untrusted text, run through the skills
   taxonomy.
3. **GitHub API** — languages and contribution activity as skill signals.

### Job / opportunity data — public listings only

Cairn ingests *public* job and issue listings to match the user against; it does not
read any user's account on a job board. Sources are limited to services with a real
API or feed (GitHub issues today; Adzuna / Remotive / USAJobs / Arbeitnow and similar
later, each behind its own mini-ADR). Where a user wants a specific board with no API,
the **browser extension** ([ADR-0014](0014-browser-extension-reuses-shared-core.md))
can capture the listing the user is already viewing — their session, their device,
their action — with no credentials and no bulk scraping. That capability gets its own
ADR when it is built.

## Consequences

- The multi-login UI is honest: GitHub is "connect your account", LinkedIn/Google are
  "faster sign-in". No per-job-board login buttons.
- LinkedIn and Google each need their own OAuth app + `cairn-auth` secret before their
  button appears. Setup is incremental.
- "Import everything from every site" is explicitly out of scope and will be declined,
  not quietly shelved.
- `libs/profile`'s `LinkedIdentity.provider` (`github | linkedin | google`) already
  matches this set; no model change.

## Alternatives considered

- **Headless login / scraping per user.** Rejected — credentials, ToS, security (see
  Context).
- **Only GitHub, no other identity providers.** Viable, but LinkedIn/Google sign-in
  is low-cost behind the shared layer and lowers the barrier for non-GitHub users.
- **A generic "connect any site" OAuth registry.** Over-engineering for three
  providers; revisit if a fourth real identity provider appears.
