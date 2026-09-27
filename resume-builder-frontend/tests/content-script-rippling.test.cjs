const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

let activeField = null;

class Element {
  constructor() { this.hidden = false; }
  matches() { return false; }
  getClientRects() { return [{}]; }
}

class Controller extends Element {
  constructor() {
    super();
    this.selected = '';
  }

  querySelectorAll() {
    return this.selected ? [{ textContent: this.selected }] : [];
  }
}

class QuestionWrapper extends Element {
  constructor(question) {
    super();
    this.question = question;
  }

  querySelector(selector) {
    return selector === '.paddingX--16 p' ? { textContent: this.question } : null;
  }
}

class DropdownField extends Element {
  constructor(id, labelId, options, question = '') {
    super();
    this.id = id;
    this.labelId = labelId;
    this.options = options.map((label) => new DropdownOption(label, this));
    this.questionWrapper = question ? new QuestionWrapper(question) : null;
    this.controller = new Controller();
    this.autocomplete = '';
    this.textContent = 'Select';
  }

  getAttribute(name) {
    if (name === 'role') return 'combobox';
    if (name === 'aria-labelledby') return this.labelId || null;
    if (name === 'aria-label') return 'Select';
    return null;
  }

  closest(selector) {
    if (selector === '[hidden], [aria-hidden="true"]') return null;
    if (selector === '[data-testid="select-controller"]') return this.controller;
    if (selector === '[data-testid="phone_number-code"]') return null;
    if (selector === '.marginY--36') return this.questionWrapper;
    return null;
  }

  focus() { activeField = this; }
  blur() {}
  click() {}
  dispatchEvent() { return true; }
}

class Input extends DropdownField {
  constructor(id, labelId, options, question = '') {
    super(id, labelId, options, question);
    this.value = '';
  }
}

class DropdownOption extends Element {
  constructor(label, field) {
    super();
    this.label = label;
    this.textContent = label;
    this.field = field;
  }

  getAttribute(name) {
    return ['aria-label', 'title'].includes(name) ? this.label : null;
  }
  closest() { return null; }
  scrollIntoView() {}
  dispatchEvent() { return true; }
  click() {
    this.field.controller.selected = this.label;
    this.field.textContent = this.label;
  }
}

class RadioQuestionWrapper extends Element {
  constructor(question) {
    super();
    this.question = question;
  }

  querySelector(selector) {
    return selector === ':scope > p' ? { textContent: this.question } : null;
  }
}

class RadioGroup extends Element {
  constructor(question) {
    super();
    this.wrapper = new RadioQuestionWrapper(question);
    this.options = [];
    this.selected = '';
  }

  closest(selector) {
    return selector === '.paddingX--16' ? this.wrapper : null;
  }

  querySelectorAll(selector) {
    return selector === '[role="radio"]' ? this.options : [];
  }
}

class RadioOption extends Element {
  constructor(label, group) {
    super();
    this.textContent = label;
    this.group = group;
  }

  getAttribute(name) {
    return name === 'role' ? 'radio' : null;
  }

  closest(selector) {
    if (selector === '[role="radiogroup"]') return this.group;
    if (selector === '[hidden], [aria-hidden="true"]') return null;
    return null;
  }

  click() { this.group.selected = this.textContent; }
}

class PhoneInput extends Input {
  constructor(phoneGroup) {
    super('field-31', '', []);
    this.phoneGroup = phoneGroup;
    this.autocomplete = 'tel';
  }

  getAttribute(name) {
    if (name === 'aria-label') return 'Phone number';
    return null;
  }

  closest(selector) {
    if (selector === '[data-testid="field"]') return this.phoneGroup;
    if (selector === '.marginY--36') return null;
    return super.closest(selector);
  }
}

class Textarea extends Element {}
class Select extends Element {}
class Button extends Element {}
class Label extends Element {}

function loadContentScript(labels) {
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
    KeyboardEvent: class KeyboardEvent {
      constructor(type) { this.type = type; }
    },
    MouseEvent: class MouseEvent {
      constructor(type) { this.type = type; }
    },
    Event: class Event {
      constructor(type) { this.type = type; }
    },
    DOMParser: class DOMParser {},
    CSS: { escape: (value) => value },
    location: {
      hostname: 'ats.rippling.com',
      pathname: '/inscipher-careers/jobs/job/apply',
      href: 'https://ats.rippling.com/inscipher-careers/jobs/job/apply',
    },
    document: {
      querySelectorAll: (selector) => selector === '[role="option"]'
        ? (activeField?.options || [])
        : [],
      getElementById: (id) => labels.get(id) || null,
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
    globalThis.testApi = { fieldLabel, profileValueForField, fillField };`;
  vm.runInContext(source, context);
  return context.testApi;
}

test('fills Rippling work authorization and EEO dropdowns and strips the separate dial code', async () => {
  activeField = null;
  const labels = new Map([
    ['field-77-label', { textContent: 'Gender' }],
    ['field-83-label', { textContent: 'Please identify your race' }],
    ['field-90-label', { textContent: 'Are you Hispanic/Latino?' }],
    ['field-96-label', { textContent: 'Veteran Status' }],
  ]);
  const api = loadContentScript(labels);
  const authorized = new DropdownField(
    'field-55',
    '',
    ['Yes', 'No'],
    'Are you authorized to work in the United States?',
  );
  const sponsorship = new DropdownField(
    'field-61',
    '',
    ['Yes', 'No'],
    'Will you now, or in the future, require sponsorship for employment visa status?',
  );
  const gender = new DropdownField('field-77', 'field-77-label', ['Male', 'Female']);
  const race = new Input('field-83', 'field-83-label', ['Asian', 'White']);
  const hispanic = new DropdownField('field-90', 'field-90-label', ['Yes', 'No']);
  const veteran = new DropdownField(
    'field-96',
    'field-96-label',
    ['I am a protected veteran', 'I am not a protected veteran'],
  );
  const phoneGroup = {
    querySelector: () => ({ value: '+1 US' }),
  };
  const phone = new PhoneInput(phoneGroup);
  const profile = {
    phone: '+1 956-539-7040',
    country: 'United States',
    legallyAuthorizedUs: 'Yes',
    requiresSponsorship: 'No',
    gender: 'Male',
    ethnicity: 'Asian',
    hispanicLatino: 'No',
  };

  const expected = new Map([
    [authorized, 'Yes'],
    [sponsorship, 'No'],
    [gender, 'Male'],
    [race, 'Asian'],
    [hispanic, 'No'],
    [veteran, 'I am not a protected veteran'],
  ]);
  for (const [field, answer] of expected) {
    assert.equal(api.profileValueForField(field, profile), answer);
    assert.equal(await api.fillField({ field }, answer), true);
    assert.equal(field.controller.selected, answer);
  }

  assert.equal(api.profileValueForField(phone, profile), '956-539-7040');
});

test('opts into Rippling application text-message updates', async () => {
  const api = loadContentScript(new Map());
  const group = new RadioGroup(
    'Check Yes or No to indicate your agreement to receive text message updates '
      + 'from InsCipher regarding your job application.',
  );
  const yes = new RadioOption('Yes - I consent to receiving text messages', group);
  const no = new RadioOption('No - I do not consent to receiving text messages', group);
  group.options = [yes, no];

  const answer = api.profileValueForField(yes, {});
  assert.equal(answer, 'Yes');
  assert.equal(await api.fillField({ field: yes }, answer), true);
  assert.equal(group.selected, 'Yes - I consent to receiving text messages');
});
