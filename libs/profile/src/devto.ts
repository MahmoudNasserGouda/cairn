import { canonicalizeSkill, isKnownSkill } from './taxonomy';
import type { IncomingInterest, ProfileFragment } from './merge';
import type { ProfileLink } from './model';
import { provenance } from './provenance';

/**
 * dev.to into a profile fragment (ADR-0036).
 *
 * Structural view of what `collectArticles` (@cairn/devto) returns, declared locally so
 * this module has no runtime dependency on the client.
 *
 * The whole decision in this source is **where the tags go**, and it is a decision about
 * what evidence means: writing about a technology is evidence of *interest*, not of
 * competence. A tutorial on Kubernetes says its author wanted to explain Kubernetes; it
 * does not say they have run it in anger.
 */
export interface DevtoArticleInput {
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly tags: readonly string[];
  readonly reactions: number;
  readonly comments: number;
  readonly publishedAt: string | null;
}

export interface DevtoInput {
  readonly username: string;
  readonly profileUrl: string;
  readonly articles: readonly DevtoArticleInput[];
}

function links(input: DevtoInput, from: ReturnType<typeof provenance>): ProfileLink[] {
  return [{ kind: 'devto', url: input.profileUrl, from }];
}

/**
 * Article tags become interests, and nothing else happens.
 *
 * Everything this source is *not* allowed to produce is the substance of the decision:
 *
 * - **No skills, not even at low confidence.** ADR-0036 rejected that explicitly: "low
 *   confidence" is how a wrong signal gets in and then gets averaged into a number
 *   somebody trusts. The distinction between interest and competence is the point, not a
 *   calibration detail.
 * - **No projects.** A `ProjectEntry` means something built; filling it with blog posts
 *   would turn every project list into a reading list. Articles are shown as links on the
 *   profile hub's Sources section and nowhere else.
 * - **No name, no identity, no experience.** A byline is not an identity, and this is
 *   read anonymously from a public feed.
 * - **Reactions and comments are read and not used.** They are popularity, and popularity
 *   is not a signal this product scores on — ADR-0017 settled the equivalent question for
 *   sponsorship. They are shown beside the article links and go no further.
 *
 * Tags carry `devto` provenance so the source can be taken back out again: interests are
 * a union with no slot for conflict, so this provenance is not for ranking anything, only
 * for withdrawing the claim.
 */
export function devtoToFragment(input: DevtoInput, capturedAt: string): ProfileFragment {
  const from = provenance('devto', capturedAt);

  const tags = new Set<string>();
  for (const article of input.articles) {
    for (const raw of article.tags) {
      const tag = canonicalizeSkill(raw);
      // `discuss`, `watercooler` and `jokes` are real dev.to tags and are not
      // technologies. The taxonomy already refuses them, which is why no extra list
      // lives here.
      if (isKnownSkill(tag)) tags.add(tag);
    }
  }

  const interests: IncomingInterest[] = [...tags].sort().map((tag) => ({ tag, from }));

  return {
    links: links(input, from),
    interests,
  };
}
