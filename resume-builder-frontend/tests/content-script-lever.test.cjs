const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {}
class Input extends Element {}
class Textarea extends Element {}
class Button extends Element {}
class Label extends Element {}

class Select extends Element {
  constructor(name, caption, optionValues, wrapperText) {
    super();
    this.id = '';
    this.name = name;
    this.caption = caption;
    this.options = optionValues.map((value) => ({ value, textContent: value, disabled: false }));
    this.labels = [{ innerText: wrapperText }];
    this.autocomplete = '';
    this.events = [];
    this._value = '';
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }

  closest(selector) {
    if (selector !== '.application-question') return null;
    return {
      querySelector: (childSelector) => childSelector === '.application-label'
        ? { innerText: this.caption }
        : null,
    };
  }

  getAttribute(name) {
    return name === 'name' ? this.name : null;
  }

  matches() {
    return false;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

function loadContentScript() {
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
    Event: class Event {
      constructor(type) { this.type = type; }
    },
    DOMParser: class DOMParser {},
    CSS: { escape: (value) => value },
    location: {
      hostname: 'jobs.lever.co',
      pathname: '/bellese/job/apply',
      href: 'https://jobs.lever.co/bellese/job/apply',
    },
    document: {
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
      },
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  vm.createContext(context);
  const sourcePath = path.resolve(__dirname, '../src/renderer/public/content-script.js');
  const source = `${fs.readFileSync(sourcePath, 'utf8')}
    globalThis.testApi = { fieldLabel, profileValueForField, fillField };`;
  vm.runInContext(source, context);
  return context.testApi;
}

test('fills Lever Gender and Race selects from saved profile values', async () => {
  const api = loadContentScript();
  const gender = new Select(
    'eeo[gender]',
    'Gender',
    ['Male', 'Female', 'Decline to self-identify'],
    'Gender Male Female Decline to self-identify',
  );
  const race = new Select(
    'eeo[race]',
    'Race',
    [
      'Hispanic or Latino',
      'White (Not Hispanic or Latino)',
      'Black or African American (Not Hispanic or Latino)',
      'Decline to self-identify',
    ],
    'Race Hispanic or Latino White (Not Hispanic or Latino) '
      + 'A person having origins in any of the original peoples of Europe, the Middle East, or North Africa.',
  );
  const profile = { gender: 'Male', hispanicLatino: 'No', ethnicity: 'White' };

  assert.equal(api.fieldLabel(gender), 'Gender');
  assert.equal(api.fieldLabel(race), 'Race');

  const genderAnswer = api.profileValueForField(gender, profile);
  const raceAnswer = api.profileValueForField(race, profile);
  assert.equal(genderAnswer, 'Male');
  assert.equal(raceAnswer, 'White');

  assert.equal(await api.fillField({ field: gender }, genderAnswer), true);
  assert.equal(await api.fillField({ field: race }, raceAnswer), true);
  assert.equal(gender.value, 'Male');
  assert.equal(race.value, 'White (Not Hispanic or Latino)');
  assert.deepEqual(gender.events, ['input', 'change', 'blur']);
  assert.deepEqual(race.events, ['input', 'change', 'blur']);
});

test('fills the negative option exposed by a Lever Veteran status select', async () => {
  const api = loadContentScript();
  const veteran = new Select(
    'eeo[veteran]',
    'Veteran status',
    ['I am a veteran', 'I am not a veteran', 'Decline to self-identify'],
    'Veteran status I am a veteran I am not a veteran Decline to self-identify',
  );

  assert.equal(api.fieldLabel(veteran), 'Veteran status');
  const answer = api.profileValueForField(veteran, {});
  assert.equal(answer, 'I am not a veteran');
  assert.equal(await api.fillField({ field: veteran }, answer), true);
  assert.equal(veteran.value, 'I am not a veteran');
  assert.deepEqual(veteran.events, ['input', 'change', 'blur']);
});
