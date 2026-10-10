import { build, context } from 'esbuild';
import { readdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const node = { platform: 'node', bundle: true, format: 'esm', target: 'node22', sourcemap: true, logLevel: 'warning', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } };
const tests = readdirSync('editor/test').filter((f) => f.endsWith('.test.ts')).map((f) => `editor/test/${f}`);

const configs = [
  { entryPoints: ['editor/src/main.tsx'], outfile: 'editor/dist/app.js', bundle: true, format: 'esm', jsx: 'automatic', target: 'chrome120', sourcemap: true, minify: !watch, logLevel: 'warning', define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' } },
  { ...node, entryPoints: ['editor/src/server.ts'], outfile: 'editor/dist/server.mjs' },
  { ...node, entryPoints: ['editor/src/cli.ts'], outfile: 'editor/dist/cli.mjs' },
  { ...node, entryPoints: tests, outdir: 'editor/dist/test', outExtension: { '.js': '.mjs' } },
];

if (watch) for (const c of configs) await (await context(c)).watch();
else {
  await Promise.all(configs.map((c) => build(c)));
  console.log('editor built');
}
