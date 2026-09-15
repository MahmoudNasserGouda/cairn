# 0035. Stack Exchange as evidence of expertise

- Status: Accepted
- Date: 2026-09-15
- Deciders: Project owner
- Measured against: [ADR-0026](0026-job-and-opportunity-ingestion.md)'s acceptance bar
- Refines: [ADR-0007](0007-deterministic-explainable-matching-engine.md),
  [ADR-0031](0031-profile-v2-provenance.md)

## Context

Every source Rujoom reads answers "what has this person *done*". None answers "what does
this person actually *know*", and the difference matters to the thing the product is for.

- A **CV** and a **LinkedIn archive** are self-reported. A skills line is a claim.
- **GitHub** and **GitLab** measure *volume* — bytes pushed in a language. Volume is a
  real signal and a poor proxy for depth: a year of copy-pasted boilerplate outweighs a
  hard library nobody else could have written.

Stack Exchange measures something neither does. `/users/{id}/top-answer-tags` returns,
per tag, the number of answers and **the score those answers earned from other
practitioners in that tag**. That is peer assessment, tag by tag, and it is the closest
thing to an external audit of a skills list that exists for free.

This is the gap the skills taxonomy has always had. `libs/profile` can tell you someone
has written Python; nothing until now could tell you whether other Python programmers
found their Python useful.

## What was verified

All from a real browser, anonymously, on an origin that is not Stack Exchange's, with a
deliberately permissive `connect-src` so a failure would be them refusing us rather than
our own CSP:

| Probe | Result |
|---|---|
| `GET /2.3/info?site=stackoverflow` | `200`, `response.type === "cors"` |
| `GET /2.3/users/22656/top-answer-tags?site=stackoverflow` | `200`, items with `tag_name`, `answer_count`, `answer_score`, `question_count`, `question_score` |
| Anonymous quota | **`quota_max: 300`** per day, per IP |
| `backoff` field | absent on these calls |

300 requests a day, unauthenticated, with **no key at all** — not a key-optional
arrangement, genuinely none. One profile import costs one or two requests.

## Against ADR-0026's bar

All five criteria hold, and unusually this source clears criterion 2 outright — it is the
first candidate that does.

1. **Documented and permitted.** `api.stackexchange.com` v2.3 is a published, versioned
   API whose documented purpose includes exactly this.
2. **No user credential.** None. A Stack Exchange user id is a public identifier; the
   data behind it is already public on the web. **Nothing is read that a stranger with a
   browser could not read.**
3. **Reachable without a secret.** Yes — CORS verified above, key-free, and the preferred
   shape under [ADR-0001](0001-local-first-zero-cost-architecture.md) and
   [ADR-0002](0002-no-mandatory-application-backend.md): a direct browser call with no
   Worker.
4. **Origin declared in both places.** `https://api.stackexchange.com` into
   `ALLOWED_CONNECT_ORIGINS` and the CSP `connect-src`, enforced by `check-csp.mjs` and
   `check-bundle-origins.mjs`.
5. **Its own mini-ADR.** This document.

## Decision

**Rujoom reads a Stack Exchange profile the user names, anonymously, and turns its
top-answer tags into skill evidence.**

### The user supplies the id; nothing is guessed

No matching a GitHub login against a Stack Exchange display name, no fuzzy identity
resolution, no "is this you?". The user pastes their profile URL or id on the profile
hub's **Sources** section, or does not. Guessing which stranger's reputation to attach to
someone's profile is a failure mode with no acceptable version.

### It contributes evidence, not a level of its own

`ProfileSkill` already carries `evidence[]` — every source's claim about a tag, kept even
when another source wins ([ADR-0031](0031-profile-v2-provenance.md)). Stack Exchange
lands there, with a note a person can check:

> **stackexchange** 72% — 140 answers scoring 1,240 in `python`

Whether it should also *win* the level is the question below.

### Precedence: below `manual`, and the rest is an open question

`manual` outranks it, as `manual` outranks everything. Where it sits relative to
`linkedin`, `cv` and `github` is genuinely unobvious and is recorded in *Open questions*
rather than settled here on instinct.

### Attribution is a condition, not a footnote

Stack Exchange content is licensed CC BY-SA and the API's terms require attribution and a
link back to the source. Anything rendered from this source carries a visible link to the
profile it came from. **If that cannot be done well in the interface, the integration
does not ship** — attribution is not a nicety we get to weigh against layout.

## Consequences

- The first external, adversarially-earned signal in the profile. A tag score is hard to
  inflate in a way a self-reported skills line is not.
- 300 requests a day is per **IP**, not per user, and a shared or NATed address is
  plausible in exactly the emerging markets this product names as its audience. The
  client must treat a quota exhaustion as *unknown*, never as zero
  ([`docs/design-system.md`](../design-system.md) — "say what you don't know"), which is
  the same discipline the merged-PR count already has.
- Coverage is uneven and skewed. Most developers have no meaningful Stack Exchange
  presence, and its demographics are not the product's. **This must therefore never
  subtract**: a user with no account is not "less proven", and readiness scoring must not
  gain a part that most users fail by default.
- Tag names are Stack Exchange's vocabulary, not ours. `c#`, `.net`, `node.js` map
  cleanly through the existing taxonomy; a long tail will not map at all and is dropped,
  the same rule the LinkedIn archive's skills follow.
- One more origin in the CSP.

## Open questions, recorded rather than guessed

- **Does it outrank a CV?** A CV is a stated claim; this is a measured one. That argues
  for placing it above `cv`. Against: a CV describes professional work, while Stack
  Exchange rewards the kind of problem that fits in a question box, and those are not the
  same competence. Undecided, and it needs a test over real shapes before it needs a
  number.
- **How does a score become a level in [0, 1]?** `answer_score` is unbounded and its
  distribution is extremely long-tailed, so any linear mapping makes almost everyone a
  beginner. A rank-based or logarithmic mapping is likely right. Whatever is chosen must
  be explainable in one sentence, per
  [ADR-0007](0007-deterministic-explainable-matching-engine.md) — a number no one can
  interrogate is indistinguishable from one we made up.

## Alternatives considered

- **Register for an API key to raise the quota.** Rejected for now: a key is a
  service-level secret that cannot live in a static bundle
  ([SECURITY.md](../../SECURITY.md) §8.4), so it would require the Worker, which would
  make the cheapest source the most expensive one. 300/day is enough to learn whether
  anyone wants this.
- **Match the user automatically from their GitHub login.** Rejected outright — see
  above. A wrong match attributes a stranger's expertise to someone's profile.
- **Read reputation and badges instead of tags.** Rejected: total reputation is one
  number with no skill attached, which is exactly the shape this project spent Phase 3
  getting away from. Per-tag scores are the part that says something.
