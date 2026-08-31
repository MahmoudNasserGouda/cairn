# 0008. AI-free Repository Health Engine

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Repository Health is a discovery-engine feature (commit frequency, maintainer activity,
PR review speed, issue resolution speed, new-contributor friendliness). The spec
requires it to work without AI.

## Decision

`libs/repository-analysis` computes a **signal-based health score** from GitHub data
already fetched via `libs/github` ([ADR-0006](0006-direct-github-api-usage.md)). Signals:

- Recent commit activity (frequency, recency, contributor spread)
- Release cadence
- Issue response behaviour (median time to first maintainer response, resolution rate)
- Pull request activity (open/merge ratio, median review latency)
- Maintainer activity (active maintainers in the last N days)
- Contributor count and bus-factor estimate
- `good first issue` / `help wanted` availability and freshness
- Documentation indicators (README size, CONTRIBUTING, CODE_OF_CONDUCT, docs folder)

Output mirrors the spec:

```
Health Score: 92
  Activity: High
  Maintenance: High
  Documentation: Good
  New Contributor Support: High
```

Same rules as [ADR-0007](0007-deterministic-explainable-matching-engine.md): pure,
deterministic, weights in versioned config, explanation object returned, unit-tested.

## Consequences

- Health can be shown for any public repo, including in the browser extension, with no
  key and no AI.
- Some signals need windowed history queries; `libs/github` must expose efficient
  windowed fetches to keep quota use low.
- Thresholds ("High" / "Medium" / "Low") are config and will need calibration against a
  sample of well- and poorly-maintained repos.

## Alternatives considered

- **AI summary of repo health.** Optional future enhancement on top of the numeric
  engine, never a replacement.
- **GitHub community-profile / OpenSSF Scorecard only.** Useful inputs to fold in, but
  insufficient alone for contributor-friendliness signals.
