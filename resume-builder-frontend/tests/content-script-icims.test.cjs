const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  matches() { return false; }
}
class Input extends Element {}
class Textarea extends Element {}
class Button extends Element {}
class Label extends Element {}

class Select extends Element {
  constructor(name, label, values) {
    super();
    this.id = name;
    this.name = name;
    this.label = label;
    this.options = values.map((value) => ({ value, textContent: value, disabled: false }));
    this.labels = [{ innerText: label }];
    this.autocomplete = '';
    this.events = [];
    this._value = '';
  }

  get value() { return this._value; }
  set value(value) { this._value = value; }
  getAttribute(name) { return name === 'name' ? this.name : null; }
  closest() { return null; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
}

class DropdownOption extends Element {
  constructor(label, onClick) {
    super();
    this.label = label;
    this.onClick = onClick;
  }

  getAttribute(name) {
    return ['aria-label', 'title'].includes(name) ? this.label : null;
  }

  get textContent() { return this.label; }
  scrollIntoView() {}
  dispatchEvent() { return true; }
  click() { this.onClick(); }
}

class DropdownContainer extends Element {
  constructor() {
    super();
    this.options = [];
  }

  setOptions(options) { this.options = options; }
  querySelectorAll(selector) {
    return selector === '[role="option"].result-selectable' ? this.options : [];
  }
  querySelector() { return null; }
}

class DropdownAnchor extends Element {
  constructor(id, label, container) {
    super();
    this.id = `${id}_icimsDropdown`;
    this.labelId = `label_${id}`;
    this.label = label;
    this.container = container;
    this.selected = '— Make a Selection —';
    this.autocomplete = label === 'Country' ? 'country-name' : '';
  }

  matches(selector) {
    return selector === 'a.dropdown-select[role="combobox"][id$="_icimsDropdown"]';
  }

  getAttribute(name) {
    if (name === 'role') return 'combobox';
    if (name === 'aria-labelledby') return this.labelId;
    if (name === 'aria-label') return this.label;
    return null;
  }

  closest() { return null; }
  querySelector(selector) {
    return selector === '.dropdown-text' ? { textContent: this.selected } : null;
  }
  focus() {}
  blur() {}
  click() {}
}

function loadContentScript(elementsById) {
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
    InputEvent: class InputEvent {
      constructor(type) { this.type = type; }
    },
    DOMParser: class DOMParser {},
    CSS: { escape: (value) => value },
    location: {
      hostname: 'careers-nationaldebtrelief.icims.com',
      pathname: '/jobs/6554/job',
      href: 'https://careers-nationaldebtrelief.icims.com/jobs/6554/job',
    },
    document: {
      querySelectorAll: () => [],
      getElementById: (id) => elementsById.get(id) || null,
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

function registerDropdown(elementsById, id, label) {
  const container = new DropdownContainer();
  const anchor = new DropdownAnchor(id, label, container);
  elementsById.set(anchor.labelId, { textContent: label });
  elementsById.set(`${anchor.id}_ctnr`, container);
  return { anchor, container };
}

test('fills iCIMS SMS consent and dependent address dropdowns', async () => {
  const elementsById = new Map();
  const sms = registerDropdown(elementsById, 'rcf3553', 'Do you consent to receive text messages from our company regarding your application status?');
  const country = registerDropdown(elementsById, '-1_PersonProfileFields.AddressCountry', 'Country');
  const state = registerDropdown(elementsById, '-1_PersonProfileFields.AddressState', 'State/Province');
  const addressType = new Select(
    '-1_PersonProfileFields.AddressType',
    'Type',
    ['Home', 'Other'],
  );

  sms.container.setOptions([
    new DropdownOption('Yes', () => { sms.anchor.selected = 'Yes'; }),
    new DropdownOption('No', () => { sms.anchor.selected = 'No'; }),
  ]);
  country.container.setOptions([
    new DropdownOption('United States', () => {
      country.anchor.selected = 'United States';
      setTimeout(() => {
        state.container.setOptions([
          new DropdownOption('New York', () => { state.anchor.selected = 'New York'; }),
        ]);
      }, 200);
    }),
  ]);

  const api = loadContentScript(elementsById);
  const profile = { country: 'United States', state: 'NY' };

  const smsAnswer = api.profileValueForField(sms.anchor, profile);
  const typeAnswer = api.profileValueForField(addressType, profile);
  const countryAnswer = api.profileValueForField(country.anchor, profile);
  const stateAnswer = api.profileValueForField(state.anchor, profile);
  assert.equal(smsAnswer, 'Yes');
  assert.equal(typeAnswer, 'Home');
  assert.equal(countryAnswer, 'United States');
  assert.equal(stateAnswer, 'New York');

  assert.equal(await api.fillField({ field: sms.anchor }, smsAnswer), true);
  assert.equal(await api.fillField({ field: addressType }, typeAnswer), true);
  assert.equal(await api.fillField({ field: country.anchor }, countryAnswer), true);
  assert.equal(await api.fillField({ field: state.anchor }, stateAnswer), true);
  assert.equal(sms.anchor.selected, 'Yes');
  assert.equal(addressType.value, 'Home');
  assert.equal(country.anchor.selected, 'United States');
  assert.equal(state.anchor.selected, 'New York');
});
