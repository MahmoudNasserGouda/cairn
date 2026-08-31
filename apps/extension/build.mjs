import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync('manifest.json', `${outdir}/manifest.json`);

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/background.ts', 'src/content.ts'],
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  platform: 'browser',
  legalComments: 'none',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  // MV3 CSP forbids eval; fail the build if any dep needs it.
  supported: { 'dynamic-import': true },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.info('extension: watching…');
} else {
  await esbuild.build(options);
  console.info('extension: built to dist/');
}
