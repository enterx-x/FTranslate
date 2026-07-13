import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [ipaArgument, baseUrlArgument] = process.argv.slice(2);

if (!ipaArgument || !baseUrlArgument) {
  throw new Error('Usage: npm run ios:prepare-download -- <path-to-ipa> <https-base-url>');
}

const baseUrl = baseUrlArgument.replace(/\/+$/u, '');
if (!baseUrl.startsWith('https://')) {
  throw new Error('iPhone OTA installation requires an HTTPS download address.');
}

const ipaPath = path.resolve(root, ipaArgument);
const publicDir = path.join(root, 'distribution', 'ios', 'public');
const ipaFileName = 'FTranslate-Mobile.ipa';
const template = await readFile(path.join(root, 'distribution', 'ios', 'manifest.plist.template'), 'utf8');
const manifest = template.replaceAll('__IPA_URL__', `${baseUrl}/${ipaFileName}`);

await mkdir(publicDir, { recursive: true });
await copyFile(ipaPath, path.join(publicDir, ipaFileName));
await writeFile(path.join(publicDir, 'manifest.plist'), manifest, 'utf8');
console.log(`Prepared iPhone download files in ${publicDir}`);
console.log(`Install page: ${baseUrl}/index.html`);
