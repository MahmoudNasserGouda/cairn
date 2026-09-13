# 0032. Design system and information architecture

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Constrained by: [ADR-0019](0019-security-first-rendering.md),
  [ADR-0004](0004-static-first-web-app-on-free-hosting.md),
  [ADR-0005](0005-angular-typescript-shared-core-monorepo.md)

## Context

`apps/web` was built engine-first: the scoring, matching, discovery and health libraries
got the attention, and the UI got whatever was needed to see their output. What shipped
is the default look of a hurried web app — and the project owner's words were that it
looks machine-made.

Concretely:

- **33 lines of global CSS.** Four colour variables, `system-ui`, one accent blue that
  appears nowhere in `brand/`.
- **The brand is unused.** `brand/README.md` defines a stone gradient
  (`#8FB4FA → #3E68C0`), a four-stone cairn mark and a wordmark. Nothing but the favicon
  uses any of it. The product is named after cairns — trail markers — and the interface
  makes no reference to that anywhere.
- **Styling is copy-pasted per component.** `.panel`, `.tag`, `button.ghost`, `.muted`,
  `.small` are redefined in `app.component.ts`, `profile.component.ts`,
  `dashboard.component.ts`, `discover.component.ts`, `settings.component.ts` and
  `repositories.component.ts`. Six definitions of the same card; they already disagree.
- **Pages are monoliths.** `profile.component.ts` is 769 lines and
  `dashboard.component.ts` 707, each carrying template, styles and logic in one file.
  There is no component library to extract into.
- **The information architecture does not match the product.** A five-item top bar of
  peer pages, where `/profile` — the thing the whole product is built on — is a CV
  uploader with a summary panel underneath.

No amount of restyling fixes the last two. They are architecture.

## Decision

### 1. A token layer is the only source of visual truth

`apps/web/src/styles/tokens.css` defines colour (the `brand/` stone ramp, extended to a
full scale with semantic aliases), type scale, spacing, radii, elevation, motion and
focus, for light and dark. Components consume tokens and **never** hard-code a value. A
token-contract test fails the build when a referenced variable stops existing, so a
removed token is a red test rather than a silently unstyled page.

### 2. A component library, in `apps/web/src/app/ui/`

`cn-card`, `cn-button`, `cn-field`, `cn-tag`, `cn-score-bar`, `cn-empty-state`,
`cn-timeline`, `cn-section`, `cn-avatar`, `cn-sheet`. These replace the duplicated CSS
above. A page that needs a new visual primitive adds it here rather than inventing one
locally.

The library stays in `apps/web`, **not** in `libs/`.
[ADR-0005](0005-angular-typescript-shared-core-monorepo.md) keeps `libs/*` framework-free;
Angular components belong to the app that renders them. The browser extension shares
*engines*, not widgets ([ADR-0014](0014-browser-extension-reuses-shared-core.md)).

### 3. Typography is self-hosted, because the CSP requires it

The CSP sets `font-src 'self'`. Google Fonts and every other font CDN are unreachable, and
[ADR-0019](0019-security-first-rendering.md) is not being widened for a typeface. One
variable font is vendored, subset to Latin, preloaded, with a real system fallback stack
so a failed load degrades rather than blanks. This is a constraint that happens to produce
the right answer: no third-party request on first paint, and no origin added to the
allowlist.

### 4. Information architecture: a shell, and a profile hub

- The top bar becomes a **sidebar shell**: the product has more than five destinations
  coming, and a horizontal strip cannot carry them.
- **`/profile` becomes a multi-section hub** — Overview · Sources · Skills · Experience ·
  Education · Projects · Open source — with sub-navigation, per-field provenance
  ([ADR-0031](0031-profile-v2-provenance.md)) and inline editing throughout. CV import and
  LinkedIn archive import move under *Sources*, which is what they are: two of four
  inputs, not the purpose of the page.
- Pages decompose into `apps/web/src/app/features/<name>/`, each a container component
  that owns state plus presentational components that take inputs and emit outputs. The
  769- and 707-line files end here.

### 5. Craft rules that keep it from drifting back

- **Empty, loading and error states are designed, not `<p class="muted">`.** Every panel
  that can be empty gets a real `cn-empty-state` with a next action.
- **Numbers carry their explanation.** Every score already computes a breakdown; the UI
  shows it inline rather than behind a toggle nobody opens.
- **Motion is functional and respects `prefers-reduced-motion`.**
- **Accessibility is a gate, not a pass:** visible focus on every interactive element,
  AA contrast on both themes, full keyboard operation of dialogs and the sidebar, real
  labels rather than placeholder text.
- **`style-src 'unsafe-inline'` stays the single ratified CSP exception** for Angular
  component styles ([ADR-0019](0019-security-first-rendering.md)). The design system adds
  no new exception, no inline event handler and no `innerHTML` path.

## Consequences

- One place to change the look; six components stop disagreeing about what a card is.
- The brand finally appears in the product it names.
- Every page is touched, and every page component test is touched with it. This is the
  largest single diff in the plan and lands last, after the data work it renders.
- New pages get cheaper: compose from `ui/`, consume tokens, done.
- A self-hosted variable font adds ~30–60 kB to first load — acceptable against a current
  ~71 kB initial transfer, and it is the only new asset on the critical path.
- The sidebar is a mobile question as much as a desktop one; it collapses to a bottom bar
  or a sheet under `768px`, and both are tested.

## Alternatives considered

- **Adopt a component framework (Angular Material, PrimeNG, Tailwind).** Rejected:
  [ADR-0021](0021-supply-chain-and-dependency-security.md) treats every runtime dependency
  as reviewed surface, and a large one arriving with its own look is exactly how a product
  ends up looking like everything else. The palette already exists in `brand/`.
- **Tokens and polish on the existing markup.** Rejected by the project owner: the
  generic card-and-pill layout survives a repaint, and the page monoliths survive it too.
- **Put the component library in `libs/ui`.** Rejected: breaks the framework-free rule for
  `libs/*` and would make the extension depend on Angular.
- **Redesign first, then the data work.** Rejected: the new pages exist to render Profile
  v2 and deep GitHub data. Designing against the current thin model would mean designing
  it twice.
