const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/shared/linkedin-profile.ts');
const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const context = { exports: {}, URL };
vm.runInNewContext(outputText, context, { filename });
const { getLinkedInProfile } = context.exports;

test('profile URLs keep their destination while displaying linkedin', () => {
  for (const href of [
    'https://www.linkedin.com/in/jane-doe/',
    'http://linkedin.com/in/jane-doe',
    'https://uk.linkedin.com/in/jane-doe?trk=profile#about',
    'https://www.linkedin.com/pub/jane-doe/12/345/678',
  ]) {
    const result = getLinkedInProfile(`  ${href}  `);
    assert.equal(result.href, href);
    assert.equal(result.label, 'linkedin');
  }
});

test('scheme-less and protocol-relative URLs resolve to the supplied LinkedIn host', () => {
  for (const input of [
    'www.linkedin.com/in/jane-doe',
    'linkedin.com/in/jane-doe',
    'uk.linkedin.com/in/jane-doe',
    '//www.linkedin.com/in/jane-doe',
  ]) {
    assert.equal(getLinkedInProfile(input).href, `https://${input.replace(/^\/\//, '')}`);
  }
});

test('usernames and profile paths do not duplicate the /in/ prefix', () => {
  for (const input of ['jane-doe', '/jane-doe/', 'in/jane-doe', '/in/jane-doe/']) {
    assert.equal(getLinkedInProfile(input).href, 'https://www.linkedin.com/in/jane-doe');
  }
  assert.equal(getLinkedInProfile('/pub/jane-doe/12/345/678').href,
    'https://www.linkedin.com/pub/jane-doe/12/345/678');
});

test('missing or invalid profile values omit the link without throwing', () => {
  for (const input of [undefined, null, '', '  ', '/', 'Jane Doe', 'in/', 'https://']) {
    assert.equal(getLinkedInProfile(input), null, String(input));
  }
});

test('unrelated hosts and unsupported URLs cannot masquerade as a LinkedIn profile', () => {
  for (const input of [
    'https://example.test/in/jane-doe',
    'https://linkedin.com.example.test/in/jane-doe',
    'https://notlinkedin.com/in/jane-doe',
    'https://linkedin.com@example.test/in/jane-doe',
    'https://example.test@linkedin.com/in/jane-doe',
    'javascript:alert(1)',
    'ftp://linkedin.com/in/jane-doe',
    'https://www.linkedin.com:8080/in/jane-doe',
    'https://www.linkedin.com\\in\\jane-doe',
  ]) {
    assert.equal(getLinkedInProfile(input), null, input);
  }
});
