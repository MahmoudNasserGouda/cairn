import type { DeveloperSnapshot, RepositorySnapshot, IssueSnapshot } from '../model';

export const juniorDev: DeveloperSnapshot = {
  experience: 'beginner',
  interests: ['web', 'developer-tools'],
  priorContributions: 0,
  skills: [
    { tag: 'javascript', level: 0.6, source: 'github' },
    { tag: 'typescript', level: 0.4, source: 'github' },
    { tag: 'html', level: 0.7, source: 'cv' },
    { tag: 'css', level: 0.5, source: 'cv' },
    { tag: 'git', level: 0.5, source: 'manual' },
  ],
};

export const angularRepo: RepositorySnapshot = {
  fullName: 'angular/angular',
  technologies: ['typescript', 'javascript', 'html', 'css', 'rxjs'],
  topics: ['web', 'framework', 'frontend'],
  activity: 0.95,
  health: 0.92,
  newcomerFriendliness: 0.7,
  requiredExperience: 'intermediate',
};

export const goodFirstIssue: IssueSnapshot = {
  number: 12345,
  difficulty: 'easy',
  requiredSkills: ['typescript', 'html'],
  scopeClarity: 0.8,
  mentorshipOffered: true,
};
