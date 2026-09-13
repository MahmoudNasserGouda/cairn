# Design system

The working reference for how Rujoom looks and behaves. Decision and rationale:
[ADR-0032](adr/0032-design-system-and-information-architecture.md). Brand source of
truth: [`brand/README.md`](../brand/README.md).

The product is named for **cairns** — stacked stones that mark a trail for whoever comes
next. That is the whole idea: someone ahead of you left a marker. The interface should
feel like guidance on a path, not a dashboard of metrics.

## Principles

1. **Earned, not decorated.** Every number on screen is computed from a named breakdown.
   Show the breakdown next to the number, not behind a disclosure nobody opens.
2. **Say what you don't know.** "Rate limited — we couldn't check" is a real state and
   gets real design. It is never rendered as a zero.
3. **The user outranks the parser.** Imported values are proposals; typed values are
   facts. The interface makes the difference visible
   ([ADR-0031](adr/0031-profile-v2-provenance.md)).
4. **Quiet by default.** Colour marks meaning — provenance, band, state — never decoration.
   One accent, used sparingly, is louder than five.
5. **Nothing renders untrusted content as HTML.** GitHub text, CV text, archive fields and
   AI output are interpolated or sanitised
   ([ADR-0019](adr/0019-security-first-rendering.md)). This is a design constraint, not
   only a security one: it rules out pasted rich text as a shortcut.

## Tokens

All in `apps/web/src/styles/tokens.css`. Components consume tokens and never hard-code a
value. A token-contract test fails the build when a referenced variable disappears.

### Colour

The stone ramp is the brand gradient (`#8FB4FA → #3E68C0`) extended to a usable scale.
Semantic aliases are what components reference — `--surface`, never `--stone-700`.

```
--stone-100 … --stone-900     brand ramp
--ink-100  … --ink-900        neutrals (warm, not pure grey)

--bg            page ground
--surface       card / panel
--surface-raised  dialog, popover, sheet
--border        hairline
--border-strong hover / focus-within
--fg            primary text
--fg-muted      secondary text
--fg-subtle     tertiary, timestamps
--accent        interactive, links, focus
--accent-fg     text on accent
--good --warn --bad --info   state
```

Every token is defined for both themes. Contrast is **AA minimum** in both, checked —
the current single accent `#6ea8fe` on `--panel` does not clear AA for body text and is
not carried over unchanged.

Source colour marks provenance and is consistent everywhere a source appears:
GitHub · LinkedIn · CV · **manual** (manual is the accent — it outranks the others).

### Type

One self-hosted variable font, Latin-subset, preloaded, with a real system fallback
(`font-src 'self'` — no font CDN is reachable, and none is being added).

```
--text-xs   0.75rem      metadata, timestamps
--text-sm   0.875rem     secondary, labels
--text-base 1rem         body
--text-lg   1.125rem     lead
--text-xl   1.375rem     section heading
--text-2xl  1.75rem      page heading
--text-3xl  2.25rem      display / score
```

Line height: `1.25` for headings, `1.6` for body. Tabular figures on every score, count
and date so columns do not shimmer when values change.

### Space, radius, elevation, motion

```
--space-1 .25rem  --space-2 .5rem  --space-3 .75rem  --space-4 1rem
--space-5 1.5rem  --space-6 2rem   --space-8 3rem    --space-12 4.5rem

--radius-sm 6px  --radius-md 10px  --radius-lg 14px  --radius-full 999px

--shadow-sm / --shadow-md / --shadow-lg   (soft, low-opacity; dark theme leans on
                                           --border rather than shadow)

--ease       cubic-bezier(.2,0,0,1)
--dur-fast   120ms      --dur-base 200ms      --dur-slow 320ms
```

Every transition sits inside `@media (prefers-reduced-motion: no-preference)`.

## Components — `apps/web/src/app/ui/`

| Component | Purpose |
|---|---|
| `cn-card` | the one panel. Replaces six divergent `.panel` definitions |
| `cn-button` | `primary` · `ghost` · `quiet` · `danger`; `sm` · `md`; loading and disabled states |
| `cn-field` | label + control + hint + error, correctly associated. Never a bare placeholder as a label |
| `cn-tag` | skill / topic / source chip, with a provenance variant |
| `cn-score-bar` | a score with its named parts — the shape every engine already returns |
| `cn-empty-state` | icon + what is missing + **the action that fixes it** |
| `cn-timeline` | dated entries: roles, education, contribution history |
| `cn-section` | heading + description + slot, the page building block |
| `cn-avatar` | image with initials fallback (GitHub avatars only; `img-src` is allowlisted) |
| `cn-sheet` | modal / drawer. Focus trap, Escape, backdrop dismiss, restores focus |

The library lives in `apps/web`, not `libs/` —
[ADR-0005](adr/0005-angular-typescript-shared-core-monorepo.md) keeps `libs/*`
framework-free.

## Layout and information architecture

**Shell.** Sidebar on `≥768px`; below that it collapses to a bottom bar with the primary
destinations and a sheet for the rest. Content column maxes at `72ch` for prose and
`1100px` for dense views.

**`/profile` is a hub, not a page.** Sections: Overview · Sources · Skills · Experience ·
Education · Projects · Open source. CV import and LinkedIn archive import live under
**Sources** — they are two of four inputs, not the purpose of the page. Every field is
editable in place and shows where its value came from.

## States — all four, every time

Every panel that can be empty, slow or wrong gets all four designed:

| State | Rule |
|---|---|
| **Empty** | say what is missing and give the action that fixes it. Never a bare "No data" |
| **Loading** | skeletons that match the final layout, so nothing jumps. `role="status"` |
| **Error** | what failed, whether it is retryable, and what still works without it |
| **Unknown** | distinct from zero. A rate-limited merged-PR count reads "couldn't check", never "0" |

## Accessibility — a gate, not a pass

- Visible focus on every interactive element. Never `outline: none` without a replacement.
- AA contrast in both themes, for text *and* for the borders that carry meaning.
- Full keyboard operation: sidebar, sheets, the profile sub-navigation, every editable
  field. Dialogs trap focus and restore it on close.
- Real `<label>`s. Placeholders are not labels.
- Icons that carry meaning have accessible names; decorative ones are `aria-hidden`.
- Live regions for async results (`role="status"`, `role="alert"`) — already the pattern
  in the CV import panel.
- Motion respects `prefers-reduced-motion`; colour is never the only signal.

## Constraints worth remembering

- `style-src 'unsafe-inline'` is the **single** ratified CSP exception, for Angular
  component styles ([ADR-0019](adr/0019-security-first-rendering.md)). The design system
  adds no new exception, no inline event handler, no `innerHTML`.
- `img-src` allows `'self'`, `data:` and `avatars.githubusercontent.com`. An avatar from
  anywhere else will not load — `cn-avatar` falls back to initials.
- `font-src 'self'`. Self-hosted or nothing.
- First-load budget: the app is ~71 kB transfer today. The variable font is the only new
  asset on the critical path; OCR models are lazy and sandboxed
  ([ADR-0028](adr/0028-ocr-and-document-vision-sandbox.md)).
