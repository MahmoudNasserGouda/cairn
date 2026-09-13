# 0029. LinkedIn data-export archive import

- Status: Accepted
- Date: 2026-09-13
- Deciders: Project owner
- Supersedes the "not a launch feature" line in
  [ADR-0012](0012-linkedin-as-oauth-identity-only.md)
- Builds on: [ADR-0011](0011-local-first-cv-processing.md),
  [ADR-0025](0025-multi-provider-identity.md)

## Context

[ADR-0012](0012-linkedin-as-oauth-identity-only.md) reduced LinkedIn to an identity
provider, and [ADR-0025](0025-multi-provider-identity.md) confirmed that this is technical
reality: there is no general profile-data API left. Re-checked 2026-09-13, still true. So
the professional-history half of the unified profile rests entirely on the CV and on
manual entry, and a user who keeps their career current on LinkedIn and nowhere else has
nothing to give us.

Two paths out exist ([`docs/data-sources.md`](../data-sources.md)):

**The DMA Member Data Portability API.** Real profile data — Member Snapshot plus a
28-day Member Changelog, scope `r_dma_portability_3rd_party`. It is a Digital Markets Act
remedy, and LinkedIn scopes consent to **members in the EEA and Switzerland only**. Access
requires a verified LinkedIn Company Page, business verification (legal name, registered
address, privacy policy, verified business email) and a LinkedIn review before any code
can be tested.

**The data-export archive.** Every member, anywhere, can request a ZIP of their own data
from Settings & Privacy → Data Privacy → Get a copy of your data. It arrives as CSV.

Rujoom's stated audience is "students, junior developers, and developers in emerging
markets". An EEA-only feature does not serve them.

## Decision

Rujoom imports the **LinkedIn data-export archive**, as a file the user supplies. The DMA
API is documented as a possible future EEA-only upgrade and is **not built**.

### The flow is the CV flow

Bytes → sandboxed, terminate-on-timeout Web Worker → parser → **mandatory review form** →
merged into the profile with provenance ([ADR-0031](0031-profile-v2-provenance.md)). No
bytes leave the device; the archive itself is never stored; only the reviewed fields
persist. This is the same contract [ADR-0011](0011-local-first-cv-processing.md) set for
CVs, and the same worker and review machinery implement it.

### What is read

`Profile.csv` · `Positions.csv` · `Education.csv` · `Skills.csv` · `Certifications.csv` ·
`Projects.csv` · `Languages.csv` · `Email Addresses.csv`

### What is refused, and why the parser enforces it

`Connections.csv` · `messages.csv` · `Invitations.csv` · `Contacts.csv` · `Reactions.csv`
· `Comments.csv`

Rujoom is building a profile of **one** person. The connection graph, message history and
contact book in that archive are other people's personal data, and those people never
consented to anything. There is no product feature that needs them.

This is a **parser rule, not a README note**: the reader takes an allowlist of entry
names and never opens anything outside it, and a test asserts that handing it an archive
containing `Connections.csv` and `messages.csv` reads neither. ADR-0012's "no storing of
connection graphs" becomes enforceable rather than aspirational.

### Implementation constraints

- The ZIP reader is the one already hardened for DOCX
  (`libs/cv-extract/src/zip.ts`: entry cap, declared-size check, streaming byte cap that
  aborts mid-inflate when the header lies). It is lifted into its own `libs/zip` and gains
  a `listZipEntries()` alongside `readZipEntry()`, because an archive must be enumerated
  before it can be filtered. Its limits are raised for archives — a LinkedIn export is
  larger than a `.docx` — with its own size cap, separate from `CV_MAX_BYTES`.
- Entry names are matched **case-insensitively and by path suffix**, because archives
  wrap their contents in a `Complete_LinkedInDataExport_<date>/` folder and filenames vary
  by vintage and locale. A file that is absent produces "this wasn't in your archive", not
  a failed import.
- CSV parsing is ours, not a dependency
  ([ADR-0021](0021-supply-chain-and-dependency-security.md)): quoted fields, embedded
  newlines, BOM, CRLF. Every value is untrusted text and is interpolated, never rendered
  as HTML.

## Consequences

- The professional-history side of the profile gets a real source for **every** user,
  not just EEA ones, with no approval dependency and no ToS exposure.
- The import is manual — the user fetches a file and drops it in — so it is a deliberate
  act rather than a background sync. For a local-first product that is the honest shape,
  and it matches how the CV already works.
- The archive is a point-in-time snapshot. Re-importing is safe because provenance and
  `manual`-wins merging ([ADR-0031](0031-profile-v2-provenance.md)) stop a re-import from
  overwriting hand-edited fields or double-counting roles.
- LinkedIn's OAuth identity role is **unchanged**: still `openid profile email`, still
  discarded after one `userinfo` call. This ADR adds a file importer, not a scope.
- We inherit whatever LinkedIn's export omits or mangles. The review form absorbs that,
  as it does for CVs.
- A new threat row in [SECURITY.md](../../SECURITY.md): hostile archive (zip bomb, path
  traversal in entry names, CSV formula injection). The first is already handled by the
  reader's caps; entry names are never used as paths; CSV values never reach a
  spreadsheet, and leading `=`/`+`/`-`/`@` are stripped from exported fields.

## Alternatives considered

- **Member Data Portability API.** Rejected as the primary path: EEA-only excludes most
  of the target audience, and the approval chain blocks development. Kept on record as an
  opt-in upgrade if a European user base ever justifies the company-page work.
- **Ask the user to paste their LinkedIn profile text.** Rejected: worse structure than
  the CSV for no less effort — though the CV parser will handle pasted text anyway.
- **Scrape the profile page the user is logged into, from the extension.** Rejected:
  ADR-0012 prohibits scraping outright, and that prohibition is not up for revision.
- **Parse the archive and store it whole for later re-use.** Rejected: SECURITY.md keeps
  imported document contents transient; only the reviewed fields persist.
