const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

let roleOptions = [];
let addressSuggestions = [];

class Element {
  matches() { return false; }
  closest() { return null; }
  getClientRects() { return [{}]; }
}

class Input extends Element {
  constructor(label, autocomplete = '', id = '') {
    super();
    this.id = id;
    this.name = '';
    this.labels = [{ textContent: label }];
    this.autocomplete = autocomplete;
    this.type = 'text';
    this.events = [];
    this._value = '';
  }

  get value() { return this._value; }
  set value(value) { this._value = value; }
  getAttribute(name) { return name === 'autocomplete' ? this.autocomplete : null; }
  focus() {}
  blur() {}
  dispatchEvent(event) { this.events.push(event.type); return true; }
}

class Textarea extends Element {}
class Select extends Element {
  constructor(label, options) {
    super();
    this.id = '';
    this.name = '';
    this.labels = [{ textContent: label }];
    this.autocomplete = '';
    this.options = options.map((textContent) => ({ textContent, value: textContent, disabled: false }));
    this.events = [];
    this._value = '';
  }

  get value() { return this._value; }
  set value(value) { this._value = value; }
  getAttribute(name) { return name === 'autocomplete' ? this.autocomplete : null; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
}
class Button extends Element {}
class Label extends Element {}

class RoleOption extends Element {
  constructor(textContent, onClick) {
    super();
    this.textContent = textContent;
    this.onClick = onClick;
  }

  getAttribute() { return null; }
  click() { this.onClick(); }
}

class RoleCombobox extends Element {
  constructor(label, id, options) {
    super();
    this.id = id;
    this.name = '';
    this.autocomplete = '';
    this.labels = [{ textContent: label }];
    this.events = [];
    this.selected = { textContent: '' };
    this.parentElement = {
      querySelector: () => this.selected,
    };
    roleOptions = options.map((option) => new RoleOption(option, () => {
      this.selected.textContent = option;
    }));
  }

  getAttribute(name) { return name === 'role' ? 'combobox' : null; }
  querySelector() { return this.selected; }
  focus() {}
  click() {}
  blur() {}
  dispatchEvent(event) { this.events.push(event.type); return true; }
}

class AddressSuggestion extends Element {
  constructor(textContent, onClick) {
    super();
    this.textContent = textContent;
    this.onClick = onClick;
    this.events = [];
  }

  matches(selector) { return selector === '.pac-item'; }
  getAttribute() { return null; }
  scrollIntoView() {}
  dispatchEvent(event) { this.events.push(event.type); return true; }
  click() { this.onClick(); }
}

function loadContentScript({ elementsById = new Map(), allFields = [] } = {}) {
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
    InputEvent: class InputEvent {
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
    location: { hostname: 'example.com', pathname: '/', href: 'https://example.com' },
    document: {
      querySelectorAll: (selector) => {
        if (selector === '[role="option"]') return roleOptions;
        if (selector.includes('.pac-container .pac-item')) return addressSuggestions;
        return allFields;
      },
      getElementById: (id) => elementsById.get(id) || null,
    },
    chrome: { runtime: { onMessage: { addListener: () => {} } } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  context.window = context;
  vm.createContext(context);
  const sourcePath = path.resolve(__dirname, '../src/renderer/public/content-script.js');
  const source = `${fs.readFileSync(sourcePath, 'utf8')}
    globalThis.testApi = { profileValueForField, fillField, fillProfileFields };`;
  vm.runInContext(source, context);
  return context.testApi;
}

test('prefers saved first, middle, and last names and fills each field', async () => {
  const api = loadContentScript();
  const first = new Input('First Name', 'given-name');
  const middle = new Input('Middle Name', 'additional-name');
  const middleInitial = new Input('Middle Initial');
  const last = new Input('Last Name', 'family-name');
  const full = new Input('Full Name', 'name');
  const profile = {
    fullName: 'Richard Nhan Tran',
    firstName: 'Richard',
    middleName: 'Nhan',
    lastName: 'Tran',
  };

  const expected = new Map([
    [first, 'Richard'],
    [middle, 'Nhan'],
    [middleInitial, 'N'],
    [last, 'Tran'],
    [full, 'Richard Nhan Tran'],
  ]);
  for (const [field, value] of expected) {
    const answer = api.profileValueForField(field, profile);
    assert.equal(answer, value);
    assert.equal(await api.fillField({ field }, answer), true);
    assert.equal(field.value, value);
  }
});

test('falls back to splitting Full Name for older profiles', () => {
  const api = loadContentScript();
  assert.equal(api.profileValueForField(new Input('First Name'), { fullName: 'Ada Byron Lovelace' }), 'Ada');
  assert.equal(api.profileValueForField(new Input('Middle Name'), { fullName: 'Ada Byron Lovelace' }), 'Byron');
  assert.equal(api.profileValueForField(new Input('Last Name'), { fullName: 'Ada Byron Lovelace' }), 'Lovelace');
});

test('input-only autofill leaves choice controls unchanged', async () => {
  const firstName = new Input('First Name', 'given-name');
  const state = new Select('State / Territory', ['Washington', 'Oregon']);
  const api = loadContentScript({ allFields: [firstName, state] });

  const result = await api.fillProfileFields({
    firstName: 'Ada',
    state: 'Washington',
  }, true);

  assert.equal(firstName.value, 'Ada');
  assert.equal(state.value, '');
  assert.deepEqual(state.events, []);
  assert.equal(result.filled, 1);
});

test('prioritizes work authorization over country wording and selects Yes', async () => {
  const api = loadContentScript();
  const field = new Select(
    'Are you legally authorized to work for any employer in the country where the position is located?',
    ['', 'Yes', 'No'],
  );
  const profile = {
    legallyAuthorizedUs: 'Yes',
    requiresSponsorship: 'No',
    country: 'United States',
  };

  const answer = api.profileValueForField(field, profile);
  assert.equal(answer, 'Yes');
  assert.equal(await api.fillField({ field }, answer), true);
  assert.equal(field.value, 'Yes');
});

test('selects No for future employment sponsorship from the saved profile', async () => {
  const api = loadContentScript();
  const field = new Select(
    'Will you now or or in the future require employment sponsorship?',
    ['', 'Yes', 'No'],
  );
  const profile = {
    legallyAuthorizedUs: 'Yes',
    requiresSponsorship: 'No',
    country: 'United States',
  };

  const answer = api.profileValueForField(field, profile);
  assert.equal(answer, 'No');
  assert.equal(await api.fillField({ field }, answer), true);
  assert.equal(field.value, 'No');
});

test('selects Yes when Greenhouse asks about the right to work in the applying country', async () => {
  const api = loadContentScript();
  const field = new Select(
    'Do you have the right to work in the country for which you are applying?',
    ['', 'Yes', 'No'],
  );
  const profile = {
    legallyAuthorizedUs: 'Yes',
    requiresSponsorship: 'No',
    country: 'United States',
  };

  const answer = api.profileValueForField(field, profile);
  assert.equal(answer, 'Yes');
  assert.equal(await api.fillField({ field }, answer), true);
  assert.equal(field.value, 'Yes');
});

test('fills ADP names and address fields whose labels include validation errors', async () => {
  const api = loadContentScript();
  const profile = {
    fullName: 'Jacob Landon Wood',
    firstName: 'Jacob',
    middleName: 'Landon',
    lastName: 'Wood',
    address1: '5456 36th Ave SW Seattle',
    city: 'Seattle',
    county: 'King',
    state: 'Washington',
    zip: '98126',
  };
  const expected = new Map([
    [new Input('First Name is required', '', 'personalInfomationFirstName'), 'Jacob'],
    [new Input('Middle Name', '', 'personalInfomationMiddleName'), 'Landon'],
    [new Input('Last Name is required', '', 'personalInfomationLastName'), 'Wood'],
    [new Input('Address Line 1 is required', 'address-line1', 'PersonalAddress_address_line1'), '5456 36th Ave SW Seattle'],
    [new Input('City', '', 'PersonalAddress_city'), 'Seattle'],
    [new Input('Zip Code', '', 'PersonalAddress_postalCode'), '98126'],
    [new Input('County', '', 'PersonalAddress_county'), 'King'],
  ]);

  for (const [field, value] of expected) {
    const answer = api.profileValueForField(field, profile);
    assert.equal(answer, value);
    assert.equal(await api.fillField({ field }, answer), true);
    assert.equal(field.value, value);
  }
});

test('fills the ADP non-input State / Territory combobox', async () => {
  const api = loadContentScript();
  const field = new RoleCombobox(
    'State / Territory is required',
    'PersonalAddress_state',
    ['California', 'Washington'],
  );
  const answer = api.profileValueForField(field, { state: 'Washington' });

  assert.equal(answer, 'Washington');
  assert.equal(await api.fillField({ field }, answer), true);
  assert.equal(field.selected.textContent, 'Washington');
});

test('fills ADP names and selects a validated full-address suggestion', async () => {
  const first = new Input('First Name is required', '', 'personalInfomationFirstName');
  const middle = new Input('Middle Name', '', 'personalInfomationMiddleName');
  const last = new Input('Last Name is required', '', 'personalInfomationLastName');
  first.value = 'Leon';
  last.value = 'Li';
  const address = new Input('Address Line 1 is required', 'address-line1', 'PersonalAddress_address_line1');
  const city = new Input('City', '', 'PersonalAddress_city');
  const zip = new Input('Zip Code', '', 'PersonalAddress_postalCode');
  const county = new Input('County', '', 'PersonalAddress_county');
  const state = new RoleCombobox('State / Territory', 'PersonalAddress_state', []);
  const elementsById = new Map([
    [first.id, first], [middle.id, middle], [last.id, last], [address.id, address],
    [city.id, city], [zip.id, zip], [county.id, county], [state.id, state],
  ]);
  addressSuggestions = [new AddressSuggestion(
    '5456 36th Ave SW, Seattle, WA 98126, USA',
    () => {
      address.value = '5456 36th Ave SW';
      city.value = 'Seattle';
      state.selected.textContent = 'Washington';
      zip.value = '98126';
      county.value = 'King';
    },
  )];
  const api = loadContentScript({
    elementsById,
    allFields: [first, middle, last, address, city, state, zip, county],
  });

  const result = await api.fillProfileFields({
    fullName: 'Jacob Landon Wood',
    firstName: 'Jacob',
    middleName: 'Landon',
    lastName: 'Wood',
    address1: '5456 36th Ave SW',
    city: 'Seattle',
    state: 'Washington',
    zip: '98126',
    county: 'King',
  });

  assert.equal(first.value, 'Jacob');
  assert.equal(middle.value, 'Landon');
  assert.equal(last.value, 'Wood');
  assert.equal(address.value, '5456 36th Ave SW');
  assert.equal(city.value, 'Seattle');
  assert.equal(state.selected.textContent, 'Washington');
  assert.equal(zip.value, '98126');
  assert.equal(county.value, 'King');
  assert.equal(result.filled, 8);
});
