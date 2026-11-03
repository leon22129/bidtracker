const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  getClientRects() { return [{}]; }
}
class Input extends Element {}
class Textarea extends Element {}
class Button extends Element {}
class Label extends Element {}

class Select extends Element {
  constructor(name, caption, optionValues, wrapperText) {
    super();
    this.id = '';
    this.tagName = 'SELECT';
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

function loadContentScript(fields = []) {
  let onMessage;
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
      querySelectorAll: (selector) => selector.includes('textarea') ? fields : [],
      getElementById: () => null,
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (listener) => { onMessage = listener; } },
      },
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  vm.createContext(context);
  const sourcePath = path.resolve(__dirname, '../src/renderer/public/content-script.js');
  const source = `${fs.readFileSync(sourcePath, 'utf8')}
    globalThis.testApi = { extractFields };`;
  vm.runInContext(source, context);
  return { ...context.testApi, onMessage };
}

test('scans Lever Gender and Race questions and choices without changing their values', () => {
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
  gender.value = 'Decline to self-identify';
  race.value = 'Decline to self-identify';
  const api = loadContentScript([gender, race]);
  const questions = api.extractFields();
  assert.equal(questions.length, 2);
  for (const [index, field] of [gender, race].entries()) {
    assert.equal(questions[index].question, field.caption);
    assert.equal(questions[index].sensitive, true);
    assert.deepEqual(Array.from(questions[index].options), field.options.map((option) => option.value));
    assert.equal(field.value, 'Decline to self-identify');
    assert.deepEqual(field.events, []);
  }
});

test('scans Lever Veteran status without selecting an answer', () => {
  const veteran = new Select(
    'eeo[veteran]',
    'Veteran status',
    ['I am a veteran', 'I am not a veteran', 'Decline to self-identify'],
    'Veteran status I am a veteran I am not a veteran Decline to self-identify',
  );

  const api = loadContentScript([veteran]);
  const [question] = api.extractFields();
  assert.equal(question.question, 'Veteran status');
  assert.equal(question.sensitive, true);
  assert.deepEqual(Array.from(question.options), veteran.options.map((option) => option.value));
  assert.equal(veteran.value, '');
  assert.deepEqual(veteran.events, []);
});

test('ignores legacy fill messages without responding or changing application fields', () => {
  const field = new Select('availability', 'Available to start immediately?', ['Yes', 'No'], 'Availability');
  field.value = 'No';
  const api = loadContentScript([field]);
  let responded = false;
  const result = api.onMessage({
    type: 'RESUME_AI_FILL_ANSWERS',
    answers: [{ question: field.caption, answer: 'Yes' }],
    profile: { fullName: 'Example Candidate' },
    coverLetterText: 'Example cover letter',
    inputBoxesOnly: true,
  }, {}, () => { responded = true; });

  assert.equal(result, undefined);
  assert.equal(responded, false);
  assert.equal(field.value, 'No');
  assert.deepEqual(field.events, []);
});
