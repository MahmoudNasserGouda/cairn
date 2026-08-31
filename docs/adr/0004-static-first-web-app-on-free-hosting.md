# 0004. Static-first web app on free hosting

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

The web application is the primary MVP. The spec calls for static deployment on
GitHub Pages, Cloudflare Pages, or equivalent free static hosting, with a target
infrastructure cost of $0/month.

## Decision

The web app will be a **fully static, client-rendered single-page application**,
built to a folder of static assets and served from a CDN-backed static host.

- **Primary host:** Cloudflare Pages (custom security headers, unlimited bandwidth on
  the free tier, preview deployments).
- **Fallback / mirror:** GitHub Pages.
- No server-side rendering, no serverless runtime as a launch dependency.
- The app must work when opened from a plain file server; deep-link routing uses a
  hash or a static-host SPA fallback.

## Consequences

- SEO for marketing pages is limited under pure client rendering; if it matters we
  pre-render the landing/about routes at build time (still static output).
- Security headers and CSP ([ADR-0019](0019-security-first-rendering.md)) are configured
  at the host (`_headers` file on Cloudflare Pages) and must be part of CI verification.
- Bandwidth and build minutes stay within free tiers; CI must fail if the bundle grows
  past an agreed budget.

## Alternatives considered

- **Netlify.** Comparable; Cloudflare chosen for header control and bandwidth terms.
- **Vercel.** Strong DX but its model nudges toward serverless functions we are
  deferring ([ADR-0002](0002-no-mandatory-application-backend.md)).
- **Self-hosted static (S3 + CloudFront, a VPS).** Rejected: recurring cost and ops.
