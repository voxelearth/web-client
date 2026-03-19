import os from 'node:os';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const crateDir = path.join(repoRoot, 'dda_voxelize_wasm');
const homeDir = os.homedir();
const targetDir = path.join(crateDir, 'target');
const pkgGitignore = path.join(crateDir, 'pkg', '.gitignore');

const existingRustflags = process.env.RUSTFLAGS?.trim();
const remapFlags = [
  `--remap-path-prefix=${homeDir}=/user-home`,
  '-C',
  'debuginfo=0',
];

const rustflags = existingRustflags
  ? `${existingRustflags} ${remapFlags.join(' ')}`
  : remapFlags.join(' ');

const result = spawnSync(
  'wasm-pack',
  ['build', crateDir, '--target', 'web', '--release'],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      RUSTFLAGS: rustflags,
    },
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.rmSync(pkgGitignore, { force: true });
