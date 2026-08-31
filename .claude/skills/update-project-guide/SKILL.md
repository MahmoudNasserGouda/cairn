---
name: update-project-guide
description: >-
  Update PROJECT_GUIDE.md after finishing a phase or a meaningful step of Open Source
  Compass. Use when the user says "update the project guide", "finished a phase",
  "end of step", "we're done with phase N", or after a batch of work that changes the
  repo map, tooling, conventions, or status. Refreshes the volatile sections, appends a
  dated changelog entry, and flags any drift from the ADRs or SECURITY.md
  non-negotiables.
---

# Update the project guide

`PROJECT_GUIDE.md` (repo root) is the living orientation document for Open Source
Compass — see [ADR-0023](../../../docs/adr/0023-living-project-guide-via-skill.md). It is
a **snapshot with a changelog**, not a real-time view. The authoritative record of
decisions is always `docs/adr/`.

Run this skill at the end of every phase and every meaningful step.

## Steps

1. **Read the current state.**
   - `PROJECT_GUIDE.md` (the whole file).
   - `docs/adr/README.md` and any ADR added or changed since the last changelog date.
   - `SECURITY.md` §8 (non-negotiables).
   - Recent git history since the last changelog entry: `git log --oneline` and
     `git diff --stat` for the range.
   - Root `package.json` (or workspace manifests) for current scripts and dependencies.
   - The `apps/` and `libs/` tree for what actually exists now.

2. **Refresh the volatile sections** of `PROJECT_GUIDE.md`:
   - **Status** — current phase, and a short "done vs next" list.
   - **Repo map** — real directories and each lib's one-line job; mark planned-not-yet-built entries.
   - **How to run / build / test / deploy** — actual commands from `package.json` / CI.
   - **Conventions** — only if they changed (new lint rule, commit convention, test pattern).
   - **Open questions** — add newly surfaced ones, strike resolved ones (note the resolving ADR).

3. **Check for drift.** Compare what the code/tooling now does against:
   - every **Accepted** ADR, and
   - the **security non-negotiables** in `SECURITY.md` §8.
   If anything conflicts (e.g. a new dependency added without review, `unsafe-inline`
   crept into a CSP, a token written to LocalStorage, a backend dependency introduced),
   **do not silently fix the guide** — add a clear **⚠ DRIFT** note in the changelog
   entry and call it out to the user for a decision.

4. **Append a changelog entry** at the bottom of `PROJECT_GUIDE.md`:
   ```
   ### YYYY-MM-DD — <phase / step name>
   - <what changed in the repo and why>
   - <guide sections updated>
   - Drift: none  |  ⚠ <describe>
   ```
   Use today's real date. Keep it to a handful of bullets.

5. **Keep the file concise.** Prune stale detail from the body (it lives in git history
   and the changelog). Target: the guide stays skimmable in about two minutes.

6. **Report** to the user: the sections you updated, the changelog entry you added, and
   any drift you flagged.

## Rules

- Never edit `PROJECT_GUIDE.md` to contradict an ADR. Surface the conflict instead.
- Never remove the changelog history.
- If `PROJECT_GUIDE.md` does not exist yet, create it from the structure described in
  [ADR-0023](../../../docs/adr/0023-living-project-guide-via-skill.md) and
  `ARCHITECTURE.md`, then add the first changelog entry.
- This skill only touches `PROJECT_GUIDE.md` (and, on first run, creates it). It does
  not modify code, ADRs, or `SECURITY.md`.
