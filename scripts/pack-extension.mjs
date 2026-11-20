// Builds dist/saveform-<version>.zip from extension/ for Chrome Web Store / AMO / Edge upload.
// The zip contains exactly the files in extension/ (minus the icon source), so a store build
// can be checked against the tagged source with: unzip -l, or diff after unzipping.
import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const out = path.join(root, 'dist', `saveform-${version}.zip`);
await mkdir(path.dirname(out), { recursive: true });
await rm(out, { force: true });
// -X drops extra file attributes, -D no directory entries: stable output for the same input.
execFileSync('zip', ['-r', '-X', '-D', '-q', out, '.', '-x', 'icons/icon.svg'], { cwd: path.join(root, 'extension') });
console.log(out);
