// Bundles the Node.js server into dist/server/index.mjs.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/node.ts'],
  outfile: 'dist/server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['pg-native', '@electric-sql/pglite'],
  // CommonJS dependencies (pg) call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
