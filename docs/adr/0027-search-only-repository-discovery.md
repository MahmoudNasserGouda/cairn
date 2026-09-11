# 0027. Repository discovery ranks from search results alone

- Status: Accepted
- Date: 2026-09-11
- Deciders: MahmoudNasserGouda

## Context

Discovery is Phase 2 of the roadmap: *"what should I contribute to?"*. Until now the
user had to name or search for a repository themselves — nothing recommended one.

The obvious implementation is to search GitHub for candidates and then score each one
with the machinery we already have: `collectHealthSignals` + `healthScore`
([ADR-0008](0008-ai-free-repository-health-engine.md)) and `repositoryMatch`
([ADR-0007](0007-deterministic-explainable-matching-engine.md)). That is also
unaffordable. `collectHealthSignals` spends six requests per repository
(commit activity, contributors, community profile, pulls, releases, good-first-issue
search). Ranking 40 candidates that way is ~240 requests against a 5000/hour core
quota — survivable once, ruinous per click — and the candidate *search* itself draws
on the Search API's separate and much smaller bucket: **10 requests a minute
unauthenticated, 30 signed in**.

We are a local-first client calling GitHub directly from the browser with the user's
own token ([ADR-0006](0006-direct-github-api-usage.md)). There is no server-side
crawler, no precomputed index, and no budget for one
([ADR-0001](0001-local-first-zero-cost-architecture.md),
[ADR-0002](0002-no-mandatory-application-backend.md)). Whatever discovery costs, the
user pays out of their own quota, at the moment they click.

## Decision

**We will rank discovery candidates using only the fields a repository *search*
response already carries, and spend no per-repository requests during a run.**

Concretely:

- `libs/discovery` plans **at most four searches** per run (`planQueries`), derived
  from the profile: the strongest language, that language filtered by
  `good-first-issues:>=3`, the second language, and one topic interest. Four fits
  several times over into the smaller (10/min) bucket.
- Each lane is a **qualifier-only query** built by `buildRepoSearchQuery` — a pure
  string function. `libs/discovery` therefore has no dependency on `libs/github`;
  the client merely executes the string.
- Candidates are scored by `DISCOVERY_WEIGHTS`, a weight map **separate from**
  `REPOSITORY_MATCH_WEIGHTS`, over six signals available in a search response:
  `skillFit`, `technologyFit`, `newcomerSignal`, `activity` (push recency),
  `approachability` (star band), `learning`.
- **Lane provenance is a signal.** A candidate returned by the `good-first-issues`
  lane was matched by GitHub's own qualifier — the strongest newcomer evidence
  obtainable without spending a request per repository — and dominates
  `newcomerSignal`.
- **A repository whose stack cannot be read is excluded, not scored.** `skillCoverage`
  returns a neutral `1` for an empty requirement list, so scoring such a candidate
  would float it to the top of the list as a perfect match. This is the same trap
  `SkillGap.analysed` exists to avoid.
- Searches run **sequentially** and a run **stops at the first rate-limit refusal**,
  keeping partial results rather than failing the page.
- **Star windows are bounded above as well as below.** Popularity is the most
  misleading signal for someone trying to land a first contribution, so
  `approachability` peaks at a band sized to the user's experience rather than
  rewarding the largest repository.

A repository the user then selects goes through the *full* path — `TargetService`
spends the health and overview requests and produces a real `repositoryMatch`. The
cheap score gets you a shortlist; the expensive score gets you a decision.

## Consequences

**Positive**

- A discovery run costs ~4 requests regardless of how many candidates come back.
- It works signed-out, which matters for the emerging-market audience the product
  targets — a user can see value before granting OAuth.
- No new dependency edge: `libs/discovery` depends only on `shared`, `scoring`,
  `matching`.

**Negative**

- Discovery scores are **coarser** than `repositoryMatch` and are not comparable with
  it. Two different numbers for the same repository is a real UX hazard; the Discover
  page labels its number as a shortlist score and routes to the dashboard for the
  real one.
- `activity` rests on a single timestamp (`pushed_at`), which a bot commit can
  inflate. The health engine's commit-activity window is strictly better and is not
  available here.
- `openIssues` from a search response counts pull requests too, so `newcomerSignal`'s
  work-available term is a proxy, not a count.
- GitHub's `good-first-issues` qualifier is only as good as maintainers' labelling.

**Follow-up**

- The star windows and the push-recency curve are guesses pending the same
  calibration data set ADR-0008 is waiting on.
- If a candidate is later promoted to a target, its cheap score could be replaced
  in-place with the real one. Not built.

## Alternatives considered

- **Deep-analyse every candidate.** Correct scores, ~240 requests per run. Rejected:
  it would exhaust an unauthenticated user's quota on the first click.
- **Analyse only the top N after a cheap pass.** A sound refinement, and compatible
  with this ADR — but it still spends 6N requests and needs a spinner per card. Left
  for later; the cheap pass had to exist first either way.
- **A server-side crawler with a precomputed index.** Best possible ranking, and a
  direct violation of ADR-0001/0002 — it needs a backend, a database, and a budget.
- **GitHub's GraphQL API** to fetch more per request. It does not expose the
  `good-first-issues` repository qualifier, needs a token (so nothing works signed
  out), and its point-based rate limiting is harder to stay inside honestly.
