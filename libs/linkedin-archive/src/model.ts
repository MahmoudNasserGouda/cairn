/**
 * What a LinkedIn data-export archive says, as data
 * ([ADR-0029](../../../docs/adr/0029-linkedin-data-export-archive-import.md)).
 *
 * Deliberately *not* profile types. This package reports what the CSVs contain and
 * stops there: no provenance, no taxonomy, no merge. `libs/profile` turns this into a
 * fragment, which is what keeps "read the archive" and "decide what it means"
 * separately testable — the same split `libs/cv-parse` and `libs/profile` already
 * have, and the reason a parser change cannot quietly alter merge behaviour.
 *
 * Every string here is untrusted text that a stranger could have put in a file.
 */

/** `Profile.csv` — the one row about the member themselves. */
export interface LinkedinIdentity {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly headline?: string;
  readonly summary?: string;
  /** As LinkedIn phrases it — "Lagos, Nigeria". */
  readonly location?: string;
  readonly industry?: string;
  /** `http(s)` only. Anything else the field contained is dropped, not carried. */
  readonly websites: readonly string[];
  /** Without the leading `@`. */
  readonly twitterHandles: readonly string[];
}

/** `Positions.csv`. */
export interface LinkedinPosition {
  readonly title: string;
  readonly organization?: string;
  readonly location?: string;
  readonly startYear?: number;
  /** `'present'` when the export left "Finished On" blank, which is what it means. */
  readonly endYear?: number | 'present';
  /** The description, split into lines with its bullet markers removed. */
  readonly highlights: readonly string[];
}

/** `Education.csv`. */
export interface LinkedinEducation {
  readonly institution: string;
  readonly degree?: string;
  readonly startYear?: number;
  readonly endYear?: number;
}

/** `Certifications.csv`. */
export interface LinkedinCertification {
  readonly name: string;
  readonly issuer?: string;
  readonly year?: number;
  readonly url?: string;
}

/** `Projects.csv`. */
export interface LinkedinProject {
  readonly name: string;
  readonly description?: string;
  readonly url?: string;
}

/** `Languages.csv`. */
export interface LinkedinLanguage {
  readonly name: string;
  /** As the export phrased it — "Native or bilingual proficiency". */
  readonly proficiency?: string;
}

/**
 * What the reader did with the archive, in enough detail to show a user.
 *
 * `skipped` exists to be **displayed**. "We found 42 files and opened 8 of them, and
 * here are the 34 we did not" is a claim a person can check against the file they
 * just downloaded, which is worth more than a privacy paragraph they have to believe.
 */
export interface ArchiveReport {
  /** Entry names that were opened, in allowlist order. */
  readonly read: readonly string[];
  /** Allowlisted files this archive did not contain, by canonical name. */
  readonly missing: readonly string[];
  /** Every other entry in the archive. None of these was opened. */
  readonly skipped: readonly string[];
}

export interface LinkedinArchive {
  /** Absent when the archive had no `Profile.csv`, or none we could read. */
  readonly identity?: LinkedinIdentity;
  readonly positions: readonly LinkedinPosition[];
  readonly education: readonly LinkedinEducation[];
  /** Raw skill names. Canonicalising them is `libs/profile`'s decision, not ours. */
  readonly skills: readonly string[];
  readonly certifications: readonly LinkedinCertification[];
  readonly projects: readonly LinkedinProject[];
  readonly languages: readonly LinkedinLanguage[];
  /** Primary address first. */
  readonly emails: readonly string[];
  readonly report: ArchiveReport;
}
