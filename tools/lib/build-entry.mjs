// 把 desktop/aicut/entry.ts 打成 desktop-dist/aicut-main.mjs（与上游 desktop:build:main 同样的 esbuild 参数）。
// 由 tools/lib/dist.mjs 在上游主进程打包之后调用。
import { build } from 'esbuild';
import { join } from 'node:path';
import { ROOT } from './integration-points.mjs';

await build({
  entryPoints: [join(ROOT, 'desktop', 'aicut', 'entry.ts')],
  outfile: join(ROOT, 'desktop-dist', 'aicut-main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  external: ['./main.mjs'],
  sourcemap: true,
  logLevel: 'info',
});
