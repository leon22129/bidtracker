const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  constructor(text = '') {
    this.hidden = false;
    this.innerText = text;
    this.textContent = text;
    this.id = '';
    this.className = '';
  }

  closest() { return null; }
  getAttribute() { return null; }
  getClientRects() { return [{}]; }
  matches() { return false; }
  querySelectorAll() { return []; }
}

class DefinitionValue extends Element {
  matches(selector) { return selector === 'dd'; }
}

class DefinitionTerm extends Element {
  constructor(label, value) {
    super(label);
    this.nextElementSibling = new DefinitionValue(value);
  }
}

class Input extends Element {}
class Textarea extends Element {}
class Select extends Element {}
class Button extends Element {}
class Label extends Element {}

function loadContentScript({ pathname, hostname = 'thomsonreuters.wd5.myworkdayjobs.com', remoteType = '', locationDetail = '', browserLocation = '', phenomJob = null, ripplingDescription = '', ripplingJob = null, throwOnFieldScan = false }) {
  const remoteTypeElement = remoteType ? new Element(remoteType) : null;
  const locationTerm = locationDetail ? new DefinitionTerm('Location', locationDetail) : null;
  const browserLocationElement = browserLocation ? new Element(browserLocation) : null;
  const ripplingDescriptionElement = ripplingDescription ? new Element(ripplingDescription) : null;
  const ripplingDataElement = ripplingJob ? new Element(JSON.stringify({
    props: { pageProps: { apiData: { jobPost: ripplingJob } } },
  })) : null;
  const phenomScript = phenomJob ? new Element(`phApp.ddo = ${JSON.stringify({
    jobDetail: { status: 200, data: { job: phenomJob } },
    siteConfig: { data: { example: true } },
  })}; phApp.sessionParams = {};`) : null;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Map,
    Set,
    Promise,
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Textarea,
    HTMLSelectElement: Select,
    HTMLButtonElement: Button,
    HTMLLabelElement: Label,
    KeyboardEvent: class KeyboardEvent {},
    Event: class Event {},
    DOMParser: class DOMParser {
      parseFromString(value) {
        const text = String(value).replace(/<[^>]*>/g, ' ');
        return { body: { innerText: text, textContent: text } };
      }
    },
    CSS: { escape: (value) => value },
    location: {
      hostname,
      pathname,
      href: `https://${hostname}${pathname}`,
    },
    document: {
      title: 'Example job',
      querySelectorAll: (selector) => {
        if (throwOnFieldScan && selector.includes('textarea') && selector.includes('[role="combobox"]')) {
          throw new Error('Application fields should not be scanned');
        }
        if (selector === '[data-automation-id="remoteType"]' && remoteTypeElement) return [remoteTypeElement];
        if (selector === '.iCIMS_JobsTable .header.left > .field-label + span' && browserLocationElement) return [browserLocationElement];
        if (selector === '.ATS_htmlPreview' && ripplingDescriptionElement) return [ripplingDescriptionElement];
        if (selector === 'dt' && locationTerm) return [locationTerm];
        if (selector === 'script' && phenomScript) return [phenomScript];
        return [];
      },
      getElementById: (id) => id === '__NEXT_DATA__' ? ripplingDataElement : null,
    },
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
      },
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  context.window = context;
  vm.createContext(context);
  const sourcePath = path.resolve(__dirname, '../src/renderer/public/content-script.js');
  const source = `${fs.readFileSync(sourcePath, 'utf8')}
    globalThis.testApi = { structuredWorkplace, extractJobDescription, extractJobHeader, composeJobDescription, extractPage };`;
  vm.runInContext(source, context);
  return context.testApi;
}

const workdayPath = '/external_career_site/job/United-States-of-America-Eagan-Minnesota/Lead-Software-Engineer--AI_JREQ202372';

test('reads Workday remote type instead of inferring it from TELECOMMUTE metadata', () => {
  const api = loadContentScript({ pathname: workdayPath, remoteType: 'remote type\nHybrid' });
  const header = api.extractJobHeader({ jobLocationType: 'TELECOMMUTE' });

  assert.deepEqual(JSON.parse(JSON.stringify(header.attributes)), [
    { label: 'Workplace', value: 'Hybrid' },
  ]);
});

test('recognizes a hybrid work model in the description when Workday remote type is unavailable', () => {
  const api = loadContentScript({ pathname: workdayPath });
  const workplace = api.structuredWorkplace({
    jobLocationType: 'TELECOMMUTE',
    description: `<p>${'About this role. '.repeat(10)}</p><p>Hybrid Work Model: This is an office-based role.</p>`,
  });

  assert.equal(workplace, 'Hybrid');
});

test('keeps Remote as the TELECOMMUTE fallback when there is no hybrid signal', () => {
  const api = loadContentScript({ pathname: workdayPath });

  assert.equal(api.structuredWorkplace({ jobLocationType: 'TELECOMMUTE' }), 'Remote');
});

test('preserves the complete location detail from a labeled definition list', () => {
  const locationDetail = 'Remote (India) · Flexible hours';
  const api = loadContentScript({
    pathname: '/careers/digital-marketing-executive',
    locationDetail,
  });
  const header = api.extractJobHeader({
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'Country', name: 'IN' },
  });

  assert.equal(header.location, locationDetail);
});

test('uses remote applicant country metadata when visible location detail is unavailable', () => {
  const api = loadContentScript({ pathname: '/careers/digital-marketing-executive' });
  const header = api.extractJobHeader({
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'Country', name: 'IN' },
  });

  assert.equal(header.location, 'Remote (India)');
});

test('omits an iCIMS placeholder location instead of presenting it as real job data', () => {
  const api = loadContentScript({
    pathname: '/jobs/4706/senior-full-stack-developer/job',
    browserLocation: 'UNAVAILABLE, US',
  });

  assert.equal(api.extractJobHeader(null).location, '');
});

test('extracts a Phenom location from its embedded job-detail state', () => {
  const location = 'Reston, Virginia, United States of America';
  const api = loadContentScript({
    pathname: '/us/en/job/IIIIIIUSR2603387EXTERNALENUS/Front-End-Web-Developer',
    phenomJob: {
      title: 'Front End Web Developer',
      location,
      multi_location: [{ location }],
    },
  });

  assert.equal(api.extractJobHeader(null).location, location);
});

test('extracts a Rippling job description from its ATS HTML preview', () => {
  const description = [
    'Who we are',
    'Athos Commerce builds software for ecommerce teams.',
    'What you will do',
    'Design, build, test, and maintain reliable software systems.',
    'Qualifications',
    'Experience delivering production software in a collaborative team.',
  ].join('\n');
  const api = loadContentScript({
    hostname: 'ats.rippling.com',
    pathname: '/athos-commerce-careers/jobs/47776f21-0c0c-425c-b0fb-b3e1cfb2e500',
    ripplingDescription: description,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(api.extractJobDescription(null))), {
    text: description,
    source: 'Rippling job description',
  });
});

test('extracts Rippling title, company, and location from its embedded job data', () => {
  const api = loadContentScript({
    hostname: 'ats.rippling.com',
    pathname: '/athos-commerce-careers/jobs/47776f21-0c0c-425c-b0fb-b3e1cfb2e500',
    ripplingJob: {
      name: 'Software Engineer II',
      companyName: 'Athos Commerce',
      workLocations: ['Denver, CO'],
    },
  });

  const header = api.extractJobHeader(null);
  assert.equal(header.title, 'Software Engineer II');
  assert.equal(header.company, 'Athos Commerce');
  assert.equal(header.location, 'Denver, CO');
});

test('places labeled job information including salary before the description', () => {
  const api = loadContentScript({ pathname: '/careers/example-role' });
  const result = api.composeJobDescription({
    title: 'Example Role',
    company: 'Example Company',
    location: 'Remote (India) · Flexible hours',
    attributes: [
      { label: 'Workplace', value: 'Remote' },
      { label: 'Employment Type', value: 'Full-time' },
      { label: 'Salary', value: '₹10,00,000 – ₹14,00,000 per year' },
    ],
  }, 'Build and improve digital campaigns.');

  assert.equal(result, [
    'Job Information',
    'Title: Example Role',
    'Company: Example Company',
    'Location: Remote (India) · Flexible hours',
    'Workplace: Remote',
    'Employment Type: Full-time',
    'Salary: ₹10,00,000 – ₹14,00,000 per year',
    '',
    'Job Description',
    'Build and improve digital campaigns.',
  ].join('\n'));
});

test('skips application-field discovery during a job-description-only scan', async () => {
  const api = loadContentScript({
    pathname: '/job-posting/4734028005',
    throwOnFieldScan: true,
  });

  const result = await api.extractPage(false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.questions)), []);
});
