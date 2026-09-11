/**
 * The taxonomy moved to `@cairn/shared` so `@cairn/github` can canonicalise repo
 * languages and topics through the same table (see the note there). Re-exported
 * here to keep `@cairn/profile`'s public surface stable.
 */
export {
  TAXONOMY_VERSION,
  SKILL_ALIASES,
  KNOWN_SKILLS,
  canonicalizeSkill,
  isKnownSkill,
  toKnownSkills,
  extractSkills,
} from '@cairn/shared';
