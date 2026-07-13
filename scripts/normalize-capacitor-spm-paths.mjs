import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageFile = path.join(root, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const source = await readFile(packageFile, 'utf8');
const normalized = source.replace(/path: "([^"]+)"/gu, (match, dependencyPath) =>
  match.replace(dependencyPath, dependencyPath.replace(/\\/gu, '/'))
);

if (normalized !== source) {
  await writeFile(packageFile, normalized, 'utf8');
  console.log('Normalized Capacitor Swift Package paths for macOS/Xcode.');
} else {
  console.log('Capacitor Swift Package paths already use portable separators.');
}
