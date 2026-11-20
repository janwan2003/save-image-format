// Builds the store packages from extension/:
//   packages/saveform-<version>-chrome.zip   Chrome Web Store and Edge Add-ons (the source tree as is)
//   packages/saveform-<version>-firefox.zip  Firefox AMO (manifest adapted, Chrome-only offscreen files left out)
// Every file except manifest.json is byte-identical to the tagged source, so a store build can be
// checked with: unzip, then diff against extension/. The manifest change for Firefox is
// firefoxManifest() below and nothing else.
import { readFile, writeFile, mkdir, rm, cp, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'extension');
const CHROME_ONLY_FILES = ['offscreen.html', 'offscreen.js'];

export function firefoxManifest(m) {
  const out = structuredClone(m);
  delete out.background.service_worker; // Firefox runs background.scripts as an event page
  delete out.minimum_chrome_version;
  // offscreen is Chrome-only (Firefox's event page has a DOM for SVG). clipboardWrite lets
  // "Copy as PNG" write the clipboard in Firefox; it shows no install warning there.
  out.permissions = out.permissions.filter((p) => p !== 'offscreen').concat('clipboardWrite');
  return out;
}

// Writes an unpacked Firefox build to dir (used by the zip below and by tests/firefox.test.mjs).
export async function buildFirefoxDir(dir) {
  await cp(src, dir, { recursive: true, filter: (f) => !CHROME_ONLY_FILES.includes(path.basename(f)) && !f.endsWith('icon.svg') });
  const m = JSON.parse(await readFile(path.join(src, 'manifest.json'), 'utf8'));
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(firefoxManifest(m), null, 2) + '\n');
  return dir;
}

function zipDir(dir, out) {
  // -X drops extra file attributes, -D no directory entries: stable output for the same input.
  execFileSync('zip', ['-r', '-X', '-D', '-q', out, '.', '-x', 'icons/icon.svg'], { cwd: dir });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile(path.join(src, 'manifest.json'), 'utf8'));
  await mkdir(path.join(root, 'packages'), { recursive: true });
  const chrome = path.join(root, 'packages', `saveform-${version}-chrome.zip`);
  const firefox = path.join(root, 'packages', `saveform-${version}-firefox.zip`);
  await rm(chrome, { force: true });
  await rm(firefox, { force: true });
  zipDir(src, chrome);
  const tmp = await mkdtemp(path.join(tmpdir(), 'saveform-ff-'));
  zipDir(await buildFirefoxDir(path.join(tmp, 'ext')), firefox);
  await rm(tmp, { recursive: true, force: true });
  console.log(chrome);
  console.log(firefox);
}
