const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const extensionRoot = resolve(__dirname, '../../resume-builder-frontend');
const { version } = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'src/renderer/public/manifest.json'), 'utf8'));

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)
  || version.split('.').some(part => Number(part) > 65535)) {
  throw new Error('Resume Builder package.json must contain a valid extension version.');
}
if (manifest.version !== version) {
  throw new Error('Resume Builder package.json and manifest.json versions must match.');
}

// Compile the version into the API so deployments do not need the extension source at runtime.
const output = resolve(__dirname, '../src/extension-release/extension-build-version.generated.ts');
const content = '// Generated from resume-builder-frontend/package.json. Do not edit.\n'
  + `export const RESUME_BUILDER_VERSION = ${JSON.stringify(version)};\n`;
if (!existsSync(output) || readFileSync(output, 'utf8') !== content) writeFileSync(output, content);
console.log(`Resume Builder required version: ${version}`);
