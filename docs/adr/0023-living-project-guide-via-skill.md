# 0023. Living project guide maintained via a skill

- Status: Accepted
- Date: 2026-08-30
- Deciders: Project owner

## Context

Project owner direction (2026-08-30): maintain a full project guide to help Claude (and
human contributors) stay oriented, and update it after each phase or step using a skill.
The project will be built incrementally across the spec's phases, largely with AI
assistance, so a single always-current orientation document has outsized value.

## Decision

- **`PROJECT_GUIDE.md`** at the repo root is the living source of truth for *where
  things are and how we work*: product summary, current phase/status, done-vs-next, repo
  map, conventions, security non-negotiables, run/build/test/deploy instructions, ADR
  pointer, open questions, and a dated changelog.
- **`.claude/skills/update-project-guide/`** is a project skill that regenerates the
  volatile sections from the current repo state (recent commits, changed files, ADR
  index, `package.json` scripts), appends a dated changelog entry, flags any drift from
  ADRs or the security non-negotiables, and keeps the file concise.
- The skill is **invoked at the end of every phase and every meaningful step**. Its
  description triggers on "finished a phase", "update the project guide", "end of step".
- `PROJECT_GUIDE.md` never contradicts an ADR; if reality has drifted, the skill
  surfaces it for a human decision rather than silently rewriting intent.

## Consequences

- One more required step per phase; cheap relative to the context it preserves.
- The guide can go stale between runs — it is explicitly a snapshot with a changelog
  date, not a real-time view. ADRs remain the authoritative record of decisions.
- If a future harness (e.g. `CLAUDE.md` conventions) overlaps, consolidate then; for now
  `PROJECT_GUIDE.md` is the single file.

## Alternatives considered

- **Rely on `CLAUDE.md` + ADRs only.** Rejected: no enforced update cadence and no
  narrative "current status" view.
- **Manual updates without a skill.** Rejected: will be skipped under deadline pressure;
  the skill makes it a one-command habit.
