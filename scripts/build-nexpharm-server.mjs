import { build } from 'esbuild';

await build({
  entryPoints: ['pms-app/lib/nexpharm-validation-server.ts'],
  bundle: true,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  format: 'esm',
  target: 'es2022',
  outfile: 'supabase/functions/nexpharm-pms/workbook.mjs',
  minify: true,
  external: ['linkedom'],
  plugins: [{
    name: 'deno-npm-import',
    setup(builder) {
      builder.onResolve({ filter: /^linkedom$/ }, () => ({ path: 'npm:linkedom@0.18.12', external: true }));
    },
  }],
});

if (process.argv[2]) {
  await build({
    entryPoints: ['supabase/functions/nexpharm-pms/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile: process.argv[2],
    external: ['npm:*'],
  });
}
