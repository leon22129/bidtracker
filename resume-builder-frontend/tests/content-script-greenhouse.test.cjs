const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

let activeField = null;

class Element {
  constructor() { this.hidden = false; }
  closest(selector) {
    if (selector === '[hidden], [aria-hidden="true"]') return null;
    return null;
  }
  getClientRects() { return [{}]; }
}

class ReactSelectControl extends Element {
  constructor() {
    super();
    this.selected = '';
  }

  querySelector(selector) {
    return selector.includes('.select__single-value') && this.selected
      ? { textContent: this.selected }
      : null;
  }
}

class ReactSelectInput extends Element {
  constructor(id, labelId, optionLabels) {
    super();
    this.id = id;
    this.labelId = labelId;
    this.autocomplete = '';
    this.control = new ReactSelectControl();
    this.options = optionLabels.map((label) => new ReactSelectOption(label, this));
  }

  getAttribute(name) {
    if (name === 'role') return 'combobox';
    if (name === 'aria-labelledby') return this.labelId;
    return null;
  }

  closest(selector) {
    if (selector === '[hidden], [aria-hidden="true"]') return null;
    if (selector.includes('.select__control')) return this.control;
    return null;
  }

  focus() { activeField = this; }
  blur() {}
  dispatchEvent() { return true; }
}

class ReactSelectOption extends Element {
  constructor(label, field) {
    super();
    this.textContent = label;
    this.field = field;
  }

  click() { this.field.control.selected = this.textContent; }
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
    HTMLInputElement: ReactSelectInput,
    HTMLTextAreaElement: Textarea,
    HTMLSelectElement: Select,
    HTMLButtonElement: Button,
    HTMLLabelElement: Label,
    KeyboardEvent: class KeyboardEvent {
      constructor(type) { this.type = type; }
    },
    Event: class Event {
      constructor(type) { this.type = type; }
    },
    DOMParser: class DOMParser {},
    CSS: { escape: (value) => value },
    location: {
      hostname: 'job-boards.greenhouse.io',
      pathname: '/boulevard/jobs/4711825006',
      href: 'https://job-boards.greenhouse.io/boulevard/jobs/4711825006',
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
    globalThis.testApi = { profileValueForField, fillField };`;
  vm.runInContext(source, context);
  return context.testApi;
}

test('maps and fills Greenhouse Hispanic/Latino and Race fields independently', async () => {
  activeField = null;
  const labels = new Map([
    ['hispanic_ethnicity-label', { textContent: 'Are you Hispanic/Latino?' }],
    ['race-label', { textContent: 'Please identify your race' }],
  ]);
  const api = loadContentScript(labels);
  const hispanic = new ReactSelectInput(
    'hispanic_ethnicity',
    'hispanic_ethnicity-label',
    ['Yes', 'No', 'Decline to self-identify'],
  );
  const race = new ReactSelectInput(
    'race',
    'race-label',
    ['Asian', 'White', 'Black or African American', 'Decline to self-identify'],
  );
  const profile = { hispanicLatino: 'No', ethnicity: 'Asian' };

  const hispanicAnswer = api.profileValueForField(hispanic, profile);
  const raceAnswer = api.profileValueForField(race, profile);
  assert.equal(hispanicAnswer, 'No');
  assert.equal(raceAnswer, 'Asian');
  assert.equal(await api.fillField({ field: hispanic }, hispanicAnswer), true);
  assert.equal(await api.fillField({ field: race }, raceAnswer), true);
  assert.equal(hispanic.control.selected, 'No');
  assert.equal(race.control.selected, 'Asian');
});
