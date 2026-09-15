# 0036. dev.to reads as interests, not as skills

- Status: Accepted
- Date: 2026-09-15
- Deciders: Project owner
- Measured against: [ADR-0026](0026-job-and-opportunity-ingestion.md)'s acceptance bar

## Context

`dev.to` (Forem) publishes a public, key-free API. `GET /api/articles?username=…` returns
everything someone has published: titles, descriptions, tags, reaction and comment
counts.

It is the cheapest source available — no auth, no key, one request — and the temptation
is to treat what it returns as skills. It should not be.

**Writing about a technology is evidence of interest, not of competence.** A tutorial on
Kubernetes says its author wanted to explain Kubernetes; it does not say they have run it
in anger. `libs/profile` already has a field for precisely this distinction, and it has
been fed only by GitHub repository topics until now:

```ts
/** A union of tag sets. No slot, so no conflict, so no provenance. */
readonly interests: readonly SkillTag[];
```

Interests drive discovery — `libs/discovery` searches partly on them — and they never
touch a match score. That is the right home for this source, and putting it anywhere else
would inflate skill levels with enthusiasm.

## What was verified

From a real browser, anonymously, on an origin that is not dev.to's, with a permissive
`connect-src` so a failure would be them refusing us:

| Probe | Result |
|---|---|
| `GET /api/articles?per_page=1` | `200`, `response.type === "cors"` |
| `GET /api/articles?username=…&per_page=2` | `200`, list returned — username filter works anonymously |
| Fields present | `title`, `description`, `url`, `tag_list`, `public_reactions_count`, `comments_count`, `user` |
| Key required | none |

`tag_list` arrives as a plain array (`["discuss", "jokes", "watercooler"]`), which is what
makes this a five-line integration rather than a parser.

## Against ADR-0026's bar

1. **Documented and permitted.** Forem's API v1 is public and documented; reading public
   articles is its purpose.
2. **No user credential.** None. A username is a public identifier and the articles are
   already published on the open web.
3. **Reachable without a secret.** Yes — CORS verified, key-free, direct from the
   browser, no Worker.
4. **Origin declared in both places.** `https://dev.to` into `ALLOWED_CONNECT_ORIGINS`
   and the CSP `connect-src`.
5. **Its own mini-ADR.** This document.

All five hold. It is the easiest pass of any candidate, and also the least valuable — the
two facts are unrelated, and it is worth not confusing cheapness with worth.

## Decision

**Rujoom reads a dev.to username the user supplies, and maps `tag_list` to `interests`
only.**

- **The user supplies the username.** No guessing from a GitHub login, for the reason
  [ADR-0035](0035-stack-exchange-as-evidence-of-expertise.md) gives: a wrong match
  attributes a stranger's writing to someone's profile.
- **Tags become `interests`, canonicalised through the existing taxonomy**, unknown tags
  dropped. `discuss`, `watercooler` and `jokes` are real dev.to tags and are not
  technologies; the taxonomy already refuses them, which is why no new filtering is
  needed.
- **Articles become `projects` — no.** Considered and rejected: a
  [`ProjectEntry`](../../libs/profile/src/model.ts) means something built, and filling it
  with blog posts would make every project list a reading list. Articles are shown as
  links under the profile hub's **Sources** section, where they are evidence the user can
  see us holding, and nowhere else.
- **No skill level, no contribution to any score.** Interests have no slot and therefore
  no provenance and no conflict, which is exactly why this fits there.

### Ranked last of the three accepted sources

[ADR-0034](0034-gitlab-as-a-second-data-connection.md) proves the Worker is optional;
[ADR-0035](0035-stack-exchange-as-evidence-of-expertise.md) adds the one externally-judged
signal in the product. This adds tags to a field that already has tags. It is accepted
because it is nearly free and because *interests* is a genuinely thin field today — it is
fed only by repository topics, which most accounts do not set — not because it is
important.

## Consequences

- `interests` stops depending entirely on whether people bother to set GitHub topics.
  That is a real improvement to discovery for writers, and no improvement at all for
  everyone else.
- One more origin in the CSP for a small return. Worth stating plainly: this is the
  weakest cost/benefit of the three, and if the CSP allowlist ever needs trimming, this
  is the first entry to go.
- Self-hosted Forem instances are out, for the same reason self-managed GitLab is
  ([ADR-0034](0034-gitlab-as-a-second-data-connection.md)): `connect-src` cannot contain
  a host the user types.
- Reaction and comment counts are read and **not used**. They are popularity, and
  popularity is not a signal this product scores on
  ([ADR-0017](0017-sponsorship-must-not-distort-scores.md) settled the equivalent
  question for sponsorship). They are shown beside the article links and go no further.

## What building it found

**The yield is lower than this ADR assumed, and in the right direction.** Read against a
real, high-volume account, thirty articles produced these tags:

```
discuss  jokes  watercooler  meta  community  devjournal
webdev  architecture  webperf  rails  …
```

Exactly one — `rails` — survived the taxonomy. The prediction that "the taxonomy already
refuses them, which is why no new filtering is needed" held, and then some: it also
refuses `webdev`, `architecture`, `webperf` and `community`, which are arguably real
interests rather than noise. That is the taxonomy's decision and it is consistent with
every other source, so nothing was changed for this one — but it means the realistic
contribution of this source is **one or two interests per profile**, not a handful. The
ADR called it the weakest of the three; that was right, and this is how weak.

**It could not have shipped honestly without fixing something older.** Interests were the
one field `forgetSource` did not rebuild, because interests have no provenance by design
— a union of tag sets with no slot for conflict
([ADR-0031](0031-profile-v2-provenance.md)). That reasoning covered ranking and said
nothing about *withdrawal*, so a disconnected GitHub kept its repository topics
permanently. Nothing made that visible while GitHub also contributed skills, links and
experience.

Here it would have been unmissable: interests are the **only** thing this source
contributes, so "Remove dev.to" would have visibly done nothing, against a Sources
section that promises every source can be taken back out. Fragments now carry the
interest claim and the profile records which sources named each tag, so a claim can be
withdrawn without giving interests a precedence they do not need. Two cases a naive
version gets wrong — two sources naming the same tag, and tags stored before any of this
existed — are covered in
[`interests.test.ts`](../../libs/profile/src/interests.test.ts).

This is the second time a Phase 8 source has been worth more for what it exposed than for
what it contributes. GitLab proved the Worker was a provider limitation rather than a
design necessity; this one found a removal path that had never worked.

## Alternatives considered

- **Skip it.** The honest alternative, and close to the right answer. Kept because the
  cost is one origin and about thirty lines, and because `interests` needs the help.
- **Treat article tags as skills at low confidence.** Rejected. "Low confidence" is how
  a wrong signal gets in and then gets averaged into a number somebody trusts. The
  distinction between interest and competence is the point, not a calibration detail.
- **Read the article bodies and extract skills from the prose.** Rejected: that is the CV
  parser's problem shape applied to text nobody wrote as a CV, and it would report a
  technology because someone explained why they dislike it.
