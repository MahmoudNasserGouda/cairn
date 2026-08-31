<!-- Conventional Commit title, e.g. feat(matching): add issue difficulty weighting -->

## What & why

## Checklist

- [ ] `npm run verify` passes locally
- [ ] Tests added/updated for behaviour changes
- [ ] No new runtime dependency **or** it is justified below and reviewed
- [ ] No new outbound origin **or** it is added to `ALLOWED_CONNECT_ORIGINS` + `_headers` and reviewed
- [ ] Scoring/weights changes bump `WEIGHTS_VERSION` and update snapshots deliberately
- [ ] Touches security surface? (CSP, sanitiser, auth, license) — flagged for @OWNER review

## Security notes

<!-- New deps, new origins, changes to auth/token/key handling, sanitiser allowlist, CSP -->

## ADR

<!-- Link the ADR this change implements or proposes, if any -->
