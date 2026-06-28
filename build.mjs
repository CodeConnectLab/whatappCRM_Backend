import { build } from 'esbuild';
import { rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

rmSync('dist', { recursive: true, force: true });

function findTs(dir, files = []) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) findTs(full, files);
    else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

await build({
  entryPoints: findTs('src'),
  outdir: 'dist',
  outbase: 'src',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: false,
  sourcemap: false,
});

console.log('Build complete → dist/');
