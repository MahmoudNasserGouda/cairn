# Data sources — what Rujoom can actually read

Research record for **"who am I?"** ([ARCHITECTURE.md §1](../ARCHITECTURE.md)). It answers
one question per source: *what can a static, backend-less, local-first browser app read
about its own user, legally and at zero cost?*

Written 2026-09-13, replacing a set of assumptions that had gone stale. It is a **research
document, not a decision** — the decisions it feeds are
[ADR-0028](adr/0028-ocr-and-document-vision-sandbox.md),
[ADR-0029](adr/0029-linkedin-data-export-archive-import.md),
[ADR-0030](adr/0030-github-graphql-profile-read.md) and
[ADR-0031](adr/0031-profile-v2-provenance.md). Facts marked **unverified** have not been
probed from a running browser and must clear
[ADR-0026](adr/0026-job-and-opportunity-ingestion.md)'s acceptance bar before any code
depends on them.

## The constraints every source is judged against

| Constraint | Source |
|---|---|
| No backend may be *required* | [ADR-0002](adr/0002-no-mandatory-application-backend.md) |
| `connect-src` is an allowlist; a new origin is a reviewed change | [SECURITY.md §8.6](../SECURITY.md) |
| No API key may be required of the user for a core path | [ADR-0001](adr/0001-local-first-zero-cost-architecture.md) |
| No scraping, no unofficial endpoints | [ADR-0012](adr/0012-linkedin-as-oauth-identity-only.md) |
| The product must work with any single source missing | [ADR-0025](adr/0025-multi-provider-identity.md) |

Two of those bite harder than they look. **CORS is the silent killer**: an API that is
free, public and documented is still unusable from a static page if it sends no
`Access-Control-Allow-Origin`. That is exactly how `api.openai.com` was ruled out as the
default AI provider (PROJECT_GUIDE changelog, 2026-09-12), and it is why every row below
carries a CORS column. And **a required client secret means a Worker**, which means the
source is no longer local-first even if the data is.

---

## 1. GitHub — the one live data connection

**Verdict: expand hard. This is where the depth is, and it is already authorised.**

[ADR-0025](adr/0025-multi-provider-identity.md) makes GitHub the only provider Rujoom
reads *data* from. What it reads today is a fraction of what the same permission level
already allows.

### What we read today

`libs/github/src/user.ts` — four REST endpoints:

| Call | Returns |
|---|---|
| `GET /user` | login, name, created_at, avatar |
| `GET /user/repos?per_page=100&sort=pushed` | up to 100 repo summaries |
| `GET /repos/{full_name}/languages` × **15** | byte counts per language |
| `GET /search/issues?q=type:pr+author:…+is:merged` | merged-PR count |

That is **up to 16 requests** for one profile load, 15 of them language lookups
(`LANGUAGE_FETCH_LIMIT = 15`), and it yields skills, interests and one synthetic
"Public GitHub activity" experience entry. Nothing else.

### What one GraphQL request returns instead

`POST https://api.github.com/graphql` — same origin, already on the allowlist, same
`read:user` permission level:

| Field | Gives us |
|---|---|
| `viewer { bio company location websiteUrl pronouns }` | the profile header we currently invent |
| `socialAccounts` | the user's own links (X, Mastodon, personal site) |
| `contributionsCollection` | commit / issue / PR / review totals, the **contribution calendar**, and `contributionsByRepository` |
| `pinnedItems(types: [REPOSITORY, GIST])` | what the user themself considers their best work |
| `repositoriesContributedTo` | **open-source track record that isn't their own repos** |
| `topRepositories { languages(first: 10) }` | every language breakdown in **one** request instead of fifteen |
| `organizations` | affiliations (needs `read:org`) |
| `sponsorshipsAsMaintainer` | maintainer standing |
| `followers` / `following` / `gists` | reach and side output |

Profile README is not in GraphQL; it comes from REST
`GET /repos/{login}/{login}/readme` and is untrusted Markdown — it goes through
`SafeHtmlService` like everything else.

**Rate limit note.** GraphQL bills against a separate 5,000-**points**/hour budget, not
the REST 5,000-requests/hour budget. A profile query of this shape costs roughly 1 point.
`libs/github/src/client.ts` already tracks limits per resource (`core` vs `search`);
`graphql` becomes a third resource rather than a special case.

### Scopes — and the `repo` trap

Current: `['read:user']`.

| Scope | Unlocks | Cost |
|---|---|---|
| `read:user` | everything in the table above except organizations | already granted |
| `user:email` | verified email addresses — lets a CV's email be matched to the account | trivial consent |
| `read:org` | `organizations`, org-visible repos | consent screen mentions organization access |
| `repo` | private repository metadata and languages | **read *and write* on all private repos** |

**Classic OAuth has no read-only private-repo scope.** GitHub's `repo` grants full
control of private repositories including write access to code. Requesting it from a
static SPA whose token lives in `sessionStorage`, in order to count language bytes, is
not a trade this product should make — see
[ADR-0030](adr/0030-github-graphql-profile-read.md) for the read-only alternatives
(fine-grained PAT with Metadata + Contents read, or a GitHub App installation).

---

## 2. LinkedIn — no profile API exists, and that is not a policy choice

**Verdict: the data-export archive. It is the only path that reaches every user.**

[ADR-0012](adr/0012-linkedin-as-oauth-identity-only.md) called LinkedIn "identity only"
in 2026-08 and [ADR-0025](adr/0025-multi-provider-identity.md) confirmed in 2026-09 that
this is technical reality, not preference. Re-checked 2026-09-13; still true. The
`r_liteprofile` / `r_basicprofile` era is over, and `openid profile email` returns a
name, a picture and an email — which is what we already take.

Three paths exist. Only one of them reaches a user in Cairo, Lagos or Karachi.

| Path | Data | Who can use it | Gate |
|---|---|---|---|
| **OIDC `userinfo`** (built) | name, picture, verified email | everyone | none |
| **Member Data Portability (3rd Party)** | Snapshot API (account history, positions, education, skills, posts) + Changelog API (28-day event log) | **EEA + Switzerland members only** | verified LinkedIn Company Page → business verification (legal name, registered address, privacy policy, business email) → LinkedIn review |
| **Data-export archive** | the profile the member sees, as CSV | **everyone, worldwide** | the user clicks a button on linkedin.com |

### Why the archive wins

It is not a consolation prize. For a **local-first** product it is strictly better than
the API:

- **Universal.** The DMA API is a Digital Markets Act remedy and LinkedIn scopes it to
  the EEA and Switzerland. Rujoom's stated audience is "students, junior developers, and
  developers in emerging markets" — the archive is the only path that serves them.
- **No approval dependency.** The DMA API requires a verified company page and a
  LinkedIn review before a single line of code can be tested. The archive needs nothing.
- **No ToS surface.** The user exports their own data and hands us the file. There is no
  endpoint to mis-call, no token to hold, no rate limit, no scraping question.
- **It is the same shape as the CV drop we already built.** Bytes → sandboxed worker →
  parser → **mandatory review form** → merged profile. `libs/cv-extract/src/zip.ts`
  already reads ZIP entries with an entry cap, a declared-size check and a streaming
  byte cap that aborts mid-inflate when the header lies.

ADR-0012 itself listed this under *Alternatives considered*: "Ask users to upload a
LinkedIn data export. Possible future convenience; not a launch feature." This is that
future. [ADR-0029](adr/0029-linkedin-data-export-archive-import.md) makes it a decision.

### The archive's contents

Requested at **Settings & Privacy → Data Privacy → Get a copy of your data**. LinkedIn
emails a ZIP, available 72 hours, re-requestable every 2 hours. Files are CSV.

**Read** (career facts about the user):

`Profile.csv` · `Positions.csv` · `Education.csv` · `Skills.csv` · `Certifications.csv` ·
`Projects.csv` · `Languages.csv` · `Email Addresses.csv`

**Refused, deliberately** (third-party PII with no product purpose):

`Connections.csv` · `messages.csv` · `Invitations.csv` · `Contacts.csv` ·
`Reactions.csv` · `Comments.csv`

The refusal is enforced in the parser, not just documented — see
[ADR-0029](adr/0029-linkedin-data-export-archive-import.md). Rujoom is building a profile
of *one* person; the connection graph and message history of everyone they know is
someone else's data and the product has no use for it.

**Unverified:** exact filenames vary by archive vintage and locale, and the ZIP may wrap
everything in a `Complete_LinkedInDataExport_<date>/` folder. The parser must match entry
names case-insensitively and by path suffix rather than by exact string, and must degrade
to "this file wasn't in your archive" rather than failing the whole import.

---

## 3. CV / résumé files — the richest source, and the worst-read one

**Verdict: rebuild. Most of the fix needs no new dependency.**

A CV is the only source that states career history in the user's own words. Rujoom
already accepts one; it reads it badly.

### What is being thrown away

`libs/cv-extract/src/pdf.ts` calls pdf.js `getTextContent()` — which returns, per text
run: `str`, `transform` (a 6-element matrix carrying **x, y and scale**), `width`,
`height`, `fontName`, `dir`, `hasEOL`. `itemsToText` keeps `str` and `hasEOL` and
discards the rest.

(One thing it genuinely cannot give us: a bold flag. pdf.js substitutes the standard
fonts and reports them all as `sans-serif`, and the objects carrying the real name
resolve only after `render()`. The per-face id it *does* report is the better signal —
"set differently from the body" is the question heading detection needs, and it survives
embedded fonts with arbitrary names.)

Everything hard about CV parsing is in what got discarded:

| Problem today | What the geometry would have told us |
|---|---|
| Two-column CVs interleave into nonsense | x-position clusters into columns; reading order follows columns, not the text stream |
| A role's bullets are orphaned from the role | indentation and vertical gaps group bullets under their heading |
| Sections guessed from a 9-word list (`SECTION_HEADS`) | font size and face identify a heading whatever it is called |
| Dates in a right-hand column detach from their role | the date column *is* a column, and can be re-joined by row |
| `guessName` takes line 1 and hopes | the largest text on page 1 is the name |

This is the **computer vision** half of the request, and it is free: the data is already
in memory, pdf.js is already a dependency, and the work is pure functions over
coordinates — testable without a browser.

### OCR — needed only for the minority case

A scanned or photographed CV has no text layer at all; `extractCvText` returns
`empty: true` and the UI currently points at manual entry
([ADR-0011](adr/0011-local-first-cv-processing.md) deferred OCR as "large payload for a
minority of inputs").

State of the art, re-checked 2026-09:

| Engine | Accuracy | Ship size | Notes |
|---|---|---|---|
| **PP-OCRv5 via ONNX Runtime Web** | best available client-side | ~8–16 MB (mobile det + rec) | WebGPU with silent WASM fallback; Apache-2.0 models, MIT runtime |
| Tesseract.js | 5–15 character points behind on modern documents | comparable | 20-year-old LSTM engine, no WebGPU, no per-line batching |

Both are WebAssembly. **Under a CSP with `script-src 'self'` and no `'wasm-unsafe-eval'`
the browser refuses to compile WebAssembly at all** — and `scripts/check-csp.mjs` fails
the build on `'wasm-unsafe-eval'` appearing in any script directive, because SECURITY.md
non-negotiable 1 forbids it.

That is a real conflict, not a config oversight. The resolution — run OCR in an
**isolated document on its own path with its own CSP**, embedded as an opaque-origin
sandboxed iframe that can reach neither the GitHub token nor the BYOK key — is
[ADR-0028](adr/0028-ocr-and-document-vision-sandbox.md).

---

## 4. Manual entry — the source that outranks all the others

**Verdict: it is not a fallback. It is the authority.**

Every automatic source is a guess: GitHub infers years from account age, the CV parser
infers a role from a date range, LinkedIn's archive reflects whatever the user last
bothered to update. What the user types is the only source that is *stated* rather than
*inferred*.

[ADR-0031](adr/0031-profile-v2-provenance.md) makes that structural: every field carries
its provenance, and `manual` always wins a conflict. Re-importing a source can never
silently overwrite a hand-edited field — which is also what makes re-import safe enough
to offer.

---

## 5. Sources considered and deferred

Researched because the brief said "LinkedIn and GitHub, …etc". None is authorised; each
needs its own mini-ADR against
[ADR-0026](adr/0026-job-and-opportunity-ingestion.md)'s acceptance bar before code.

### GitLab

**The most interesting of the four, for a reason unrelated to its data.** GitLab supports
**Authorization Code with PKCE for public clients** and sends CORS headers on its OAuth
endpoints (preflight support since 15.1). Every other provider Rujoom uses forced the
`cairn-auth` Worker into the path because none offers workable public-client PKCE
([SECURITY.md non-negotiable 5](../SECURITY.md)). GitLab would be the **first provider
that needs no Worker at all** — a genuinely local-first data connection.

Data is comparable to GitHub's: projects, languages, merge requests, events, groups.
Audience overlap with GitHub is high but not total, and GitLab is common inside
employers' internal estates.

**Verified 2026-09-15**: `/.well-known/openid-configuration` returns
`code_challenge_methods_supported: ["plain", "S256"]`, and `/api/v4/projects/:id`,
`/languages` and `/groups/:id/projects` all answer with CORS anonymously. Languages come
back as **normalised percentages** rather than GitHub's raw byte counts. Accepted in
[ADR-0034](adr/0034-gitlab-as-a-second-data-connection.md).

**Re-verified 2026-09-15, on the two endpoints the decision actually rests on.** The
first round tested the data endpoints and the discovery document, which is a weaker
claim than it looks: PKCE in a browser lives or dies on the **token** endpoint, and every
authenticated read carries an `Authorization` header, which is not CORS-safelisted and so
needs a preflight answered.

| Probe | Result |
|---|---|
| `POST /oauth/token`, form-encoded, from a foreign origin | `response.type === "cors"`, JSON error body readable |
| `GET /api/v4/user` with an `Authorization` header | `401`, `type === "cors"` — the preflight was answered |

Both hold, so the flow is real rather than merely documented.

**To enable it on a deployment**, register a GitLab *application* (User settings →
Applications) and put its id in `OAUTH_PROVIDERS.gitlab.clientId`. Two settings are not
optional:

- **Redirect URI** must match the deployed origin exactly, trailing slash included.
- **Confidential must be unchecked.** A confidential application demands a client secret
  the browser cannot hold, and fails with `invalid_client` — the same error an unknown
  application id gives, which makes it an easy hour to lose.

Until an id is set, `isProviderConfigured` hides GitLab entirely: no row on the profile
hub, no button in the sign-in sheet. A connection that cannot be completed is worse than
an absent one, because it reads as broken rather than as unconfigured.

### Bitbucket

REST 2.0 with OAuth 2.0. **Verified 2026-09-15**: `api.bitbucket.org` is CORS-enabled and
readable anonymously, and `auth.atlassian.com` advertises `S256` — so an earlier claim
here that it would need the Worker was wrong and is withdrawn. It is declined anyway, on
value: it reports one primary language per repository where GitHub and GitLab give a
breakdown, and its remaining share sits in private estates Rujoom cannot read.
**Declined in [ADR-0037](adr/0037-declined-sources.md).**

### Stack Exchange / Stack Overflow

`api.stackexchange.com` returns reputation, top tags by score, badges and answer counts —
a direct, independent signal of *what someone actually knows*, which is exactly the gap
the skills taxonomy struggles with.

**Verified 2026-09-15**, from a real browser on a foreign origin: CORS present
(`response.type === "cors"`), **no key at all**, anonymous quota **300 requests/day per
IP**. `/2.3/users/{id}/top-answer-tags` returns `tag_name`, `answer_count`,
`answer_score`, `question_count`, `question_score` — peer-assessed depth, per tag.
Accepted in [ADR-0035](adr/0035-stack-exchange-as-evidence-of-expertise.md), with
attribution (CC BY-SA) as a shipping condition.

### dev.to / Forem

`dev.to/api/articles?username=…` lists published articles — evidence of communication
and topic interest, not of competence.

**Verified 2026-09-15**: CORS present, key-free, the `username` filter works anonymously,
and `tag_list` arrives as a plain array. Accepted in
[ADR-0036](adr/0036-dev-to-as-interests-not-skills.md) — mapped to `interests` **only**,
never to skills.

### Personal site / portfolio URL

The user pastes a URL; we extract skills and links. **Blocked by design**: a browser
cannot fetch an arbitrary cross-origin URL, and `connect-src` is an allowlist that cannot
contain "anything the user types" without abandoning
[SECURITY.md non-negotiable 6](../SECURITY.md). Two honest paths exist — the browser
extension's `activeTab` capture (the pattern ADR-0026 already sanctions), or the user
pasting the *text* rather than the URL. Neither is a fetch.
**Declined in [ADR-0037](adr/0037-declined-sources.md)**, as a boundary rather than a
backlog item.

### Job boards

Settled already and unchanged:
[ADR-0026](adr/0026-job-and-opportunity-ingestion.md). Indeed has no job-seeker endpoint;
Wuzzuf, Bayt, Gulf Talent and Naukri publish no API. Public feeds plus extension capture,
one mini-ADR per source, none authorised yet.

---

## Summary

| Source | Reach | Auth | Backend needed | Verdict |
|---|---|---|---|---|
| GitHub GraphQL | worldwide | OAuth (Worker) | already there | **expand now** |
| LinkedIn archive | worldwide | none — a file | no | **build** |
| CV: layout parsing | worldwide | none | no | **build** |
| CV: OCR | worldwide | none | no, but needs a CSP-isolated sandbox | **build, behind ADR-0028** |
| Manual entry | worldwide | none | no | **build — and it outranks the rest** |
| LinkedIn DMA API | EEA + CH only | OAuth + LinkedIn review | Worker | documented, not built |
| GitLab | worldwide | OAuth **PKCE, no Worker** — verified | **no** | **accepted — ADR-0034** |
| Stack Exchange | worldwide | key-free, 300/day per IP | no — CORS verified | **accepted — ADR-0035** |
| dev.to | worldwide | none | no — CORS verified | **accepted — ADR-0036**, interests only |
| Bitbucket | worldwide | anonymous reads work | no — CORS verified | **declined — ADR-0037**, on value |
| Personal site URL | — | — | — | **declined — ADR-0037**; paste the text or capture it |

## References

- [Member Data Portability (3rd Party) — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-3rd-party/?view=li-dma-data-portability-2026-08)
- [Member Data Portability (Member) — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-member/?view=li-dma-data-portability-2026-05)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [GitLab OAuth 2.0 — PKCE for public clients](https://gitlab.com/gitlab-org/gitlab/-/blob/master/doc/api/oauth2.md)
- [CSP `script-src` and `'wasm-unsafe-eval'` — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
- [On-device OCR reviewed — PaddleOCR vs Tesseract vs transformer OCR](https://lofttools.com/blog/on-device-ocr-reviewed/)
