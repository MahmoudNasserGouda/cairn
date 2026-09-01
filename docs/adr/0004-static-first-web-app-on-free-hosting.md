# 0004. Static-first web app on free hosting

- Status: Accepted (amended 2026-09-01, 2026-09-02)
- Date: 2026-08-30
- Deciders: Project owner

> **Amendment 2026-09-01.** Primary host is **Cloudflare Workers static assets**
> (`wrangler deploy`, no `main` script) rather than Cloudflare Pages. Same vendor,
> same free tier, same `_headers`/`_redirects` support and unlimited bandwidth; the
> Workers platform is where Cloudflare is investing and it publishes to the account's
> `*.workers.dev` subdomain (`cairn.mahmoudnasser98.workers.dev`) with no paid custom
> domain required. Nothing else in this ADR changes.
>
> **Amendment 2026-09-02.** The **GitHub Pages mirror is dropped.** GitHub Pages
> ignores the `_headers` file, so the mirror served the app with none of the CSP or
> security headers the threat model requires ([ADR-0019](0019-security-first-rendering.md),
> [SECURITY.md](../../SECURITY.md) §8) — a weaker copy of the site on a second public
> URL was a net liability, not resilience. Cloudflare Workers is the sole host. If a
> mirror is wanted later it must carry the same headers (e.g. Cloudflare Pages as the
> fallback, or a `<meta http-equiv>` CSP baked into a Pages build).

## Context

The web application is the primary MVP. The spec calls for static deployment on
GitHub Pages, Cloudflare Pages, or equivalent free static hosting, with a target
infrastructure cost of $0/month.

## Decision

The web app will be a **fully static, client-rendered single-page application**,
built to a folder of static assets and served from a CDN-backed static host.

- **Host:** Cloudflare Workers static assets (custom security headers via `_headers`,
  unlimited bandwidth on the free tier, preview uploads). Sole host — see the
  2026-09-01 and 2026-09-02 amendments above. _(Was Cloudflare Pages + a GitHub Pages
  mirror.)_
- No server-side rendering, no serverless runtime as a launch dependency.
- The app must work when opened from a plain file server; deep-link routing uses a
  hash or a static-host SPA fallback.

## Consequences

- SEO for marketing pages is limited under pure client rendering; if it matters we
  pre-render the landing/about routes at build time (still static output).
- Security headers and CSP ([ADR-0019](0019-security-first-rendering.md)) are configured
  at the host (`_headers` file, honoured by Cloudflare Workers static assets) and must
  be part of CI verification. A host that cannot serve `_headers` is not an acceptable
  target (this is why the GitHub Pages mirror was dropped — 2026-09-02 amendment).
- Bandwidth and build minutes stay within free tiers; CI must fail if the bundle grows
  past an agreed budget.

## Alternatives considered

- **Netlify.** Comparable; Cloudflare chosen for header control and bandwidth terms.
- **Vercel.** Strong DX but its model nudges toward serverless functions we are
  deferring ([ADR-0002](0002-no-mandatory-application-backend.md)).
- **Self-hosted static (S3 + CloudFront, a VPS).** Rejected: recurring cost and ops.
