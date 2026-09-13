# 0031. Profile v2: one editable profile with per-field provenance

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Refines: [ADR-0011](0011-local-first-cv-processing.md),
  [ADR-0012](0012-linkedin-as-oauth-identity-only.md),
  [ADR-0025](0025-multi-provider-identity.md)
- Enables: [ADR-0029](0029-linkedin-data-export-archive-import.md),
  [ADR-0030](0030-github-graphql-profile-read.md)

## Context

`UnifiedProfile` holds seven fields: identities, skills, technologies, experience level,
interests, experience entries, total years. It was sized for what the two live sources
could produce — GitHub language bytes and a date-range regex over CV text.

Both sources are about to produce far more
([ADR-0029](0029-linkedin-data-export-archive-import.md),
[ADR-0030](0030-github-graphql-profile-read.md)), and the model cannot hold it: no
education, no projects, no certifications, no spoken languages, no links, no summary, no
contact details, no per-role bullets, no contribution history.

Three defects make growing it in place unsafe.

**Nothing records where a field came from.** `SkillProficiency` carries a `source`, but
experience entries carry one only by convention and scalar fields carry none. A user
cannot be shown why the profile claims something, and the app cannot tell an inference
from a statement.

**A hand edit cannot survive a re-import.** There is nowhere to record that a field was
typed rather than parsed, so any re-import would overwrite it.

**Merging is not idempotent.** `mergeProfile` *concatenates* experience entries, so
importing the same CV twice doubles the years. `ProfileService` works around this by
rebuilding the whole profile from the GitHub base on every change
(`core/profile/profile.service.ts:58`) — a workaround that only holds while there are
exactly two sources.

## Decision

### 1. Every field carries its provenance

```ts
interface Provenance {
  readonly source: 'github' | 'linkedin' | 'cv' | 'manual';
  /** How much the source's own shape supports this value, in [0, 1]. */
  readonly confidence: number;
  /** ISO date the value was captured. Supplied by the caller, never read from a clock. */
  readonly capturedAt: string;
}
```

Provenance is data, not decoration. It drives the merge, it is rendered in the UI so a
user can see why the profile says what it says, and it is what makes "re-import safely"
and "edit anything" compatible.

### 2. `manual` always wins

The precedence order for a conflicting field is:

**`manual` > `linkedin` > `cv` > `github`**

- `manual` is the only source that is *stated* rather than *inferred*, so it is absolute:
  no import may overwrite a hand-edited field, ever. Clearing a manual edit is itself a
  manual act.
- `linkedin` and `cv` are both the user's own account of their career; LinkedIn's archive
  is structured data and the CV is parsed prose, so the archive is trusted first on the
  fields both carry.
- `github` is last on biography, because everything it offers there is inference — but it
  is *first* on the things only it observes (languages by byte count, contribution
  history, repositories contributed to), which no other source claims.

Ties inside a source are broken by `confidence`, then by `capturedAt`, then
deterministically by field order. No clock is read inside the merge: `capturedAt` is
passed in, the same discipline [ADR-0007](0007-deterministic-explainable-matching-engine.md)
imposes on scoring.

### 3. Merging is idempotent and entity-based

Experience, education, projects and certifications merge by **identity** — a normalised
(title, organization, start year) key — not by concatenation. Re-importing a source
updates the entries it owns and leaves the rest alone. Importing the same file twice is a
no-op.

This retires the rebuild-from-base workaround in `ProfileService`.

### 4. The model grows to `PROFILE_SCHEMA_VERSION = 2`, with a migration

Added: contact (name, emails, location, headline, summary), links, experience with
organization / location / employment type / bullets, education, projects, certifications,
spoken languages, GitHub contribution stats, and per-field provenance throughout.

**Correction, found while building it (2026-09-13).** This section first claimed a v1
`UnifiedProfile` was persisted under `profile:cv:v1`. It was not: `ProfileService`
stored only the reviewed `ParsedCv` there and **rebuilt the profile from GitHub on
every page load**. That was not a caching choice — it was the workaround for the
concatenating merge described above, and it is also why hand edits were impossible.
A profile regenerated from its sources on every load has nowhere to keep one.

So the migration is `ParsedCv` → a provenance-tagged fragment (`parsedCvToFragment`),
and the real change is that the **merged profile is now stored**, under `profile:v2`.
The legacy `profile:cv:v1` record is read once and then left in place rather than
deleted, so a broken migration can be retried against the CV the user confirmed.

`readStoredProfile` accepts only the current schema and only when its collections are
the shape the rest of the code will index into. Anything else returns `null`, the
stored value is preserved untouched, and the user is told — a profile that fails to
load is never silently discarded.

### 5. Everything is editable, and manual entry is a first-class source

Every field on the profile page is directly editable, and editing stamps it `manual`.
Manual entry is not a fallback for when import fails — it is the highest-precedence
source in the system, and the UI says so.

The **mandatory review step** for imported data ([ADR-0011](0011-local-first-cv-processing.md))
is unchanged and now applies to the LinkedIn archive too: nothing from any file reaches
the profile without confirmation.

### 6. Two corrections the implementation forced

**A role is identified by where and when, not by what it was called.** Keying on the
title made every typo fix a *second* role: the corrected entry got a new key, the
original stayed, and the next import restored the misspelling. Organisation and start
year survive rewording, so they are the key. The accepted cost is that two genuinely
different roles at the same employer starting the same year merge into one — rare,
usually a promotion recorded twice, and a far better failure than a profile that gains
a duplicate every time someone fixes a letter.

**A losing claim is kept, not discarded.** `Sourced<T>` carries the claims it beat, the
way a skill carries its evidence. Without that, "remove my imported CV" would blank a
name the CV happened to outrank instead of falling back to the one GitHub still
reports — because the losing claim had already been thrown away. It is what makes
`forgetSource` a demotion rather than a deletion.

## Consequences

- The profile page can show, per field, where the value came from and let the user
  override it — which is what "all possible info about the user" requires to be honest
  rather than merely large.
- Re-import becomes safe, so it can be offered freely: reconnect GitHub, drop a newer CV,
  import a fresh LinkedIn archive, and nothing hand-written is lost.
- Skill levels can be reconciled across sources instead of `mergeProfile`'s current
  "highest level wins regardless of source".
- Cost: the model roughly quadruples, every reader of `UnifiedProfile` is touched
  (`libs/matching`, `libs/discovery`, `libs/portfolio`, `apps/web` services and pages),
  and a migration must be maintained.
- Storage grows, but stays well inside IndexedDB limits and stays local
  ([ADR-0003](0003-no-mandatory-database-local-first-storage.md)). Raw CV text, raw
  archive bytes and the files themselves remain **un**stored.
- `DeveloperSnapshot` (the matching engine's input) is unchanged, so the scoring engines
  need no rework — `profileToSnapshot` absorbs the new shape.

## Alternatives considered

- **Keep one flat profile and add fields.** Rejected: without provenance there is no way
  to make re-import safe or hand edits durable, which is the actual requirement.
- **Store one profile per source and merge at read time.** Considered seriously; it makes
  provenance trivial. Rejected because the user edits the *merged* view, so an edit would
  have to be attributed back to a source — which is provenance again, with an extra layer.
- **Last-write-wins by timestamp.** Rejected: an automatic import would beat a
  considered hand edit purely by being more recent.
- **Let AI reconcile conflicting sources.** Rejected: AI is frozen
  ([ADR-0033](0033-ai-capability-frozen.md)), and a non-deterministic merge cannot be
  explained to a user or snapshot-tested.
