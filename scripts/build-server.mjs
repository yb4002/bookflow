// Bundles the API server into a single ESM file for production (`npm start`).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  entryPoints: { index: 'server/index.ts', cli: 'server/cli.ts' },
  outdir: 'dist-server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  // Node built-ins (incl. node:sqlite) stay external; npm deps are bundled.
  packages: 'bundle',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
})
