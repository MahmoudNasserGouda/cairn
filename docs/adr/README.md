# Architecture Decision Records

This directory records the significant architectural decisions for **Cairn**.

## Format

Each record is a Markdown file named `NNNN-short-title.md` and follows a MADR-style
template:

```
# NNNN. Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- Date: YYYY-MM-DD
- Deciders: <who>

## Context
Why this decision is needed. Forces at play, constraints, relevant spec sections.

## Decision
What we decided, stated in the active voice ("We will ...").

## Consequences
Positive, negative, and neutral outcomes. Follow-up work. Open questions.

## Alternatives considered
Other options and why they were not chosen.
```

## Lifecycle

`Proposed` → `Accepted` → (`Superseded by ADR-XXXX` | `Deprecated`).

Never edit the decision of an `Accepted` record to reverse it — write a new ADR that
supersedes it and update the old record's Status line to point at the new one.

## Index

| #    | Title                                                            | Status              |
|------|------------------------------------------------------------------|---------------------|
| 0001 | Local-first, zero-cost architecture                             | Accepted            |
| 0002 | No mandatory application backend                                | Accepted            |
| 0003 | No mandatory database; local-first storage                      | Accepted            |
| 0004 | Static-first web app on free hosting                            | Accepted            |
| 0005 | Angular + TypeScript + shared-core monorepo                     | Accepted            |
| 0006 | Direct GitHub API usage from the browser                        | Accepted            |
| 0007 | Deterministic, explainable Matching Engine                      | Accepted            |
| 0008 | AI-free Repository Health Engine                                | Accepted            |
| 0009 | BYOK AI as an optional enhancement                              | Accepted            |
| 0010 | AI key privacy and data disclosure                              | Accepted            |
| 0011 | Local-first CV processing                                       | Accepted            |
| 0012 | LinkedIn as OAuth / identity only                               | Accepted            |
| 0013 | Client-side portfolio generation                                | Accepted            |
| 0014 | Browser extension reuses the shared core                        | Accepted            |
| 0015 | Desktop / local agent                                           | Proposed (future)   |
| 0016 | Optional serverless API                                         | Accepted            |
| 0017 | Sponsorship must not distort organic scores                     | Accepted (principle)|
| 0018 | Monetization: donations + no-backend paid features from the MVP | Accepted            |
| 0019 | Security-first rendering: CSP, sanitisation, Trusted Types      | Accepted            |
| 0020 | OAuth token and BYOK key handling                               | Accepted            |
| 0021 | Supply-chain and dependency security                            | Accepted            |
| 0022 | CI/CD is mandatory infrastructure                               | Accepted            |
| 0023 | Living project guide maintained via a skill                     | Accepted            |
| 0024 | GitHub OAuth token-exchange function                            | Accepted            |
