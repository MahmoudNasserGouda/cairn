# 0037. Declined sources: Bitbucket, and the personal-site URL

- Status: Accepted
- Date: 2026-09-15
- Deciders: Project owner
- Measured against: [ADR-0026](0026-job-and-opportunity-ingestion.md)'s acceptance bar
- Follows the precedent set by [ADR-0025](0025-multi-provider-identity.md) for recording
  a decline in writing

## Context

The Phase 8 research named five additional sources. Three are accepted
([ADR-0034](0034-gitlab-as-a-second-data-connection.md),
[ADR-0035](0035-stack-exchange-as-evidence-of-expertise.md),
[ADR-0036](0036-dev-to-as-interests-not-skills.md)). These two are not, for different
reasons, and both reasons are worth having on the record — a source that is declined
quietly gets re-proposed every six months.

## Decision 1 — Bitbucket: declined, on value

**Not built. Not deferred pending verification; declined on the merits.**

Bitbucket's REST 2.0 API exists, is documented, and would work. It is declined on what
it would *add*, not on whether it is reachable.

### What was verified, including a correction

The first draft of this ADR declined Bitbucket partly on the grounds that its OAuth
offers no workable public-client PKCE flow, and would therefore need the `cairn-auth`
Worker. **That claim was not verified and appears to be wrong**, so it is withdrawn
rather than quietly softened:

| Probe (real browser, anonymous, permissive `connect-src`) | Result |
|---|---|
| `GET bitbucket.org/.well-known/openid-configuration` | `404` — Bitbucket publishes no discovery document |
| `GET auth.atlassian.com/.well-known/openid-configuration` | `200`, `code_challenge_methods_supported: ["S256"]` |
| `GET api.bitbucket.org/2.0/repositories/atlassian` | `200`, `response.type === "cors"` |

So: the API **is** CORS-enabled and readable anonymously, and Atlassian's identity
platform **does** advertise `S256`. Whether Bitbucket's own OAuth consumers can use that
flow is a further question this ADR does not answer — but "it would need the Worker" is
not an established fact and cannot carry the decision.

### What the decision actually rests on

Two reasons, both about value:

- **The language data is weaker, and that is the input that matters.** Bitbucket reports
  a repository's primary language. GitHub gives byte counts per language; GitLab gives
  normalised percentages. A single `language` string per repository is a much cruder
  input to `languageSkills` than either, and language volume is the whole of what a code
  host contributes to the profile.
- **The audience overlap runs the wrong way.** Bitbucket's remaining share is
  concentrated in private corporate estates — work Rujoom cannot read without exactly the
  write-capable scope [ADR-0030](0030-github-graphql-profile-read.md) refused. The public
  open-source population is small and largely also on GitHub, so for most users this adds
  a connection flow and no new information.

Against ADR-0026's bar it would plausibly pass all five, including criterion 3 as a
direct browser call. **Passing the bar is not a reason to build something.** The bar
establishes what is permissible; whether it earns its place is a separate judgement, and
here the answer is no, with nobody asking.

**What would change this.** A user who keeps real public work on Bitbucket and asks for
it. Because the API is CORS-enabled and anonymous reads work, the cheap version — read a
named public account with no OAuth at all, the shape
[ADR-0036](0036-dev-to-as-interests-not-skills.md) uses for dev.to — is a small amount of
work, and is where this should start if it ever does. This ADR would then be superseded
rather than argued with.

## Decision 2 — the personal-site URL: declined, on architecture

**Not built, and not buildable in the browser as specified. This is a design boundary,
not a backlog item.**

The proposal was: the user pastes the URL of their portfolio or personal site, and Rujoom
reads it and extracts skills and links. It cannot.

A browser cannot fetch an arbitrary cross-origin URL. Two independent things stop it, and
they stop it for good reasons:

1. **Our own CSP.** `connect-src` is an **allowlist**. Making it accept "whatever the user
   types" means `connect-src *`, which abandons
   [SECURITY.md](../../SECURITY.md) non-negotiable 6 and removes the control that stops a
   compromised dependency beaconing data out. That control is worth more than this
   feature. This is not close.
2. **The remote site's CORS.** Even with `connect-src *`, an ordinary personal site sends
   no `Access-Control-Allow-Origin`, so the read fails anyway. The overwhelming majority
   of the target URLs are unreadable by any browser, from any origin, by design.

A server-side fetcher would solve both and is refused separately: it is a crawler, and
[ADR-0026](0026-job-and-opportunity-ingestion.md) declines crawling outright — *"no
crawler, no bulk import, no server-side scrape"* — while
[ADR-0002](0002-no-mandatory-application-backend.md) declines the backend it would need.
It would also make Rujoom's servers fetch URLs supplied by users, which is a
server-side-request-forgery surface with nothing to show for it.

### Two honest paths, neither of which is a fetch

Both already exist in the product's vocabulary, and either would serve the actual need:

- **Paste the text, not the URL.** The CV pipeline already accepts pasted plain text,
  runs it through `libs/cv-parse`, and puts the result in front of a mandatory review
  form. A user who wants their portfolio's prose read can paste it today, and it costs
  nothing to build because it is the same path.
- **Capture it with the extension.** [ADR-0026](0026-job-and-opportunity-ingestion.md)
  already sanctions `activeTab` plus an explicit user gesture for exactly this shape: the
  user is looking at the page, clicks the toolbar action, and the content is read on their
  device with no fetch and no server. That is the sanctioned mechanism for "read the page
  I am on", and a portfolio is a page.

Neither is what was asked for. Both give the user the outcome they wanted, which is that
their site's content reaches their profile.

## Consequences

- Two fewer origins in the CSP allowlist, and no crawler.
- The personal-site request is answered rather than parked: a user who asks gets "paste
  the text, or use the extension", not "planned".
- If Bitbucket is ever wanted, this ADR is superseded, not reinterpreted. Recording the
  reasoning is what makes that a decision rather than a reversal.
- One asymmetry worth naming: this project reads a LinkedIn *file* the user downloads but
  refuses to read a *URL* the user pastes. That is consistent, not arbitrary — a file the
  user hands over involves no request to anyone, while a URL requires someone's server to
  answer us. The boundary is who does the fetching, and it always has been.
