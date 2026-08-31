/**
 * Point git at .githooks so the secret-scan / format hook runs locally.
 * No-ops in CI and when git is unavailable (keeps `npm ci` quiet).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || !existsSync('.git')) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.info('git hooks path set to .githooks');
} catch {
  console.info('skipping git hooks setup (git not available)');
}
