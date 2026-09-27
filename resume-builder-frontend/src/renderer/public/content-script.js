const RESUME_AI_EXTRACT_PAGE = "RESUME_AI_EXTRACT_PAGE";
const RESUME_AI_FILL_ANSWERS = "RESUME_AI_FILL_ANSWERS";

const DESCRIPTION_SELECTORS = [
  '[data-automation-id="jobPostingDescription"]',
  '[data-testid="job-posting-description"]',
  '[data-testid="jobad-description"]',
  '[data-testid="job-description"]',
  '#job_description',
  '#job-description',
  '.job-description',
  '.job__description',
  '.jobDescription',
  '[class*="jobDescription"]',
  '[class*="job-description"]',
  '[class*="job_description"]',
  '[id*="jobDescription"]',
  '[id*="job-description"]',
  'article',
  'main',
];

const TITLE_SELECTORS = [
  '.job__title h1',
  '[data-automation-id="jobPostingHeader"]',
  '[data-testid="job-title"]',
  '.posting-headline h2',
  'main h1',
  'h1',
];

const LOCATION_SELECTORS = [
  '.job__location',
  '[data-automation-id="locations"]',
  '[data-testid="job-location"]',
  '[data-ui="job-location"]',
  '.posting-categories .location',
];

const JOB_ATTRIBUTE_SELECTORS = [
  { label: 'Workplace', selectors: ['[data-ui="job-workplace"]', '[data-testid="job-workplace"]'] },
  { label: 'Department', selectors: ['[data-ui="job-department"]', '[data-testid="job-department"]'] },
  { label: 'Employment type', selectors: ['[data-ui="job-type"]', '[data-testid="job-type"]'] },
];

const FIELD_SELECTOR = [
  'textarea',
  'select',
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input[type="number"]',
  'input[type="email"]',
  'input[type="date"]',
  'input[type="radio"]',
  'input[type="checkbox"]',
  '[role="combobox"]',
  'button[aria-haspopup="listbox"]',
].join(',');

const IDENTITY_FIELD = /^(?:(?:legal |preferred )?(?:first|given|preferred|middle|last|family|full) name(?: legal| preferred)?|e-?mail(?: address)?|phone(?: number)?|phone (?:device )?type|phone extension|mobile(?: phone| number)?|street address|address(?: line)? [12]|city|location(?: city)?|candidate location|state|state province|province|county|postal code|zip(?: postal)?(?: code)?|country(?: of residence)?|resume|upload resume|cover letter|linkedin(?: profile| url)?|website|portfolio(?: url)?|search|subscribe(?: to job alerts)?|.*notify me of new opportunities.*|.*text message updates.*|opt in text messaging)$/i;
const SENSITIVE_FIELD = /\b(?:race|ethnicity|gender|sex|sexual orientation|hispanic|latino|veteran|disability|disabled|religion|marital|pregnancy|pregnant|medical|health|age|social security|ssn|national id|pronoun|pronouns|salary history|current salary|sponsorship)\b|date of birth|birth date|voluntary self.identification|legally authorized|authorized to work|work authorization/i;

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanLabel(value) {
  return cleanText(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*\*\s*(required)?\s*$/i, '')
    .replace(/\s*\(required\)\s*$/i, '')
    .replace(/^required\s*/i, '')
    .trim();
}

function normalize(value) {
  return cleanLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isVisible(element) {
  if (!(element instanceof HTMLElement) || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && element.getClientRects().length > 0;
}

function parseJobPostingJsonLd() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || 'null');
      const entries = Array.isArray(value) ? value : value?.['@graph'] || [value];
      const posting = entries.find((entry) => {
        const type = entry?.['@type'];
        return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
      });
      if (!posting?.description) continue;
      const parser = new DOMParser();
      const parsed = parser.parseFromString(String(posting.description), 'text/html');
      const description = cleanText(parsed.body.innerText || parsed.body.textContent);
      if (description.length >= 120) return description.slice(0, 20000);
    } catch {
      // Ignore malformed metadata and continue with visible HTML.
    }
  }
  return '';
}

function descriptionScore(element, text, selectorIndex) {
  const identity = `${element.id} ${element.className || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const headingText = Array.from(element.querySelectorAll('h1,h2,h3,strong'))
    .slice(0, 12)
    .map((item) => cleanText(item.textContent))
    .join(' ')
    .toLowerCase();
  let score = Math.min(text.length, 12000) / 100;
  if (/job.?description|job.?posting|position.?description|posting.?description/.test(identity)) score += 180;
  if (/responsibilit|qualification|requirement|about (the )?(role|job)|what you.ll do/.test(headingText)) score += 100;
  if (element.matches('main, article')) score += 25;
  if (element.querySelectorAll('p,li').length >= 4) score += 30;
  if (selectorIndex < 13) score += 80;
  if (text.length > 30000) score -= 150;
  if (element.matches('body,nav,header,footer') || element.closest('nav,header,footer')) score -= 300;
  return score;
}

function extractJobDescription() {
  const structured = parseJobPostingJsonLd();
  if (structured) return { text: structured, source: 'JobPosting metadata' };

  const candidates = [];
  const seen = new Set();
  DESCRIPTION_SELECTORS.forEach((selector, selectorIndex) => {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element) || !isVisible(element)) continue;
      seen.add(element);
      const text = cleanText(element.innerText || element.textContent);
      if (text.length < 120) continue;
      candidates.push({
        text,
        source: selector,
        score: descriptionScore(element, text, selectorIndex),
      });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best?.score >= 90 ? { text: best.text.slice(0, 20000), source: best.source } : { text: '', source: null };
}

function firstVisibleText(selectors, maximumLength = 300) {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!isVisible(element)) continue;
      const value = cleanText(element.innerText || element.textContent);
      if (value && value.length <= maximumLength) return value;
    }
  }
  return '';
}

function extractJobHeader() {
  const attributes = JOB_ATTRIBUTE_SELECTORS.flatMap(({ label, selectors }) => {
    const value = firstVisibleText(selectors);
    return value ? [{ label, value }] : [];
  });
  return {
    title: firstVisibleText(TITLE_SELECTORS),
    location: firstVisibleText(LOCATION_SELECTORS),
    attributes,
  };
}

function textFromIds(ids) {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((element) => cleanText(element.innerText || element.textContent))
    .filter(Boolean)
    .join(' ');
}

function fieldLabel(field) {
  if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox')) {
    const namedQuestionLabel = field.name ? document.getElementById(`${field.name}_label`) : null;
    const namedQuestionText = cleanLabel(namedQuestionLabel?.innerText || namedQuestionLabel?.textContent);
    if (namedQuestionText) return namedQuestionText;

    const fieldset = field.closest('fieldset');
    const legend = fieldset?.querySelector(':scope > legend');
    const legendText = cleanLabel(legend?.innerText || legend?.textContent);
    if (legendText) return legendText;

    const group = field.closest('[role="radiogroup"], [role="group"]');
    const groupLabelledBy = group?.getAttribute('aria-labelledby');
    if (groupLabelledBy) {
      const groupText = textFromIds(groupLabelledBy);
      if (groupText) return cleanLabel(groupText);
    }

    if (field.type === 'radio') {
      let groupParent = field.parentElement;
      for (let depth = 0; groupParent && depth < 4; depth += 1, groupParent = groupParent.parentElement) {
        const candidates = Array.from(groupParent.children).filter((child) =>
          child.matches('label, [data-automation-id="formLabel"], [class*="label"], [data-testid*="label"]')
          && !child.contains(field)
          && (!(child instanceof HTMLLabelElement) || child.control !== field),
        );
        const groupText = cleanLabel(candidates[0]?.innerText || candidates[0]?.textContent);
        if (groupText && groupText.length <= 500) return groupText;
      }
    }
  }

  const labels = Array.from(field.labels || []).map((label) => cleanText(label.innerText || label.textContent)).filter(Boolean);
  if (labels.length) return cleanLabel(labels.join(' '));

  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = textFromIds(labelledBy);
    if (text) return cleanLabel(text);
  }

  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel) return cleanLabel(ariaLabel);

  const fieldset = field.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend) {
    const text = cleanLabel(legend.innerText || legend.textContent);
    if (text) return text;
  }

  let parent = field.parentElement;
  for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
    const candidate = parent.querySelector([
      ':scope > label',
      ':scope > [data-automation-id="formLabel"]',
      ':scope > [class*="label"]',
      ':scope > [data-testid*="label"]',
      // Gem application fields are unlabelled inputs. Their visible caption is
      // either a direct sibling or one wrapper below the field container.
      ':scope > span[class*="bodyImportant"]',
      ':scope > div > span[class*="bodyImportant"]',
    ].join(', '));
    const text = cleanLabel(candidate?.innerText || candidate?.textContent);
    if (text && text.length <= 500) return text;
  }

  return cleanLabel(field.getAttribute('placeholder') || field.getAttribute('name') || '');
}

function optionLabel(field) {
  const explicit = field.labels?.[0];
  const explicitText = cleanLabel(explicit?.innerText || explicit?.textContent);
  if (explicitText) return explicitText;
  const parentLabel = field.closest('label');
  const parentText = cleanLabel(parentLabel?.innerText || parentLabel?.textContent);
  if (parentText) return parentText;
  return cleanLabel(field.getAttribute('aria-label') || field.value);
}

function fieldOptions(field) {
  if (field instanceof HTMLSelectElement) {
    return Array.from(field.options)
      .filter((option) => option.value && !option.disabled)
      .map((option) => cleanLabel(option.textContent))
      .filter(Boolean);
  }
  if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox') && field.name) {
    const escapedName = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(field.name) : field.name.replace(/["\\]/g, '\\$&');
    return Array.from(document.querySelectorAll(`input[name="${escapedName}"]`))
      .map(optionLabel)
      .filter(Boolean);
  }
  return [];
}

function extractFields() {
  const records = [];
  const seenGroups = new Set();
  const seenQuestions = new Set();
  for (const field of document.querySelectorAll(FIELD_SELECTOR)) {
    if (!isVisible(field) || field.disabled || field.readOnly) continue;
    const groupKey = field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type) && field.name
      ? `${field.type}:${field.name}`
      : null;
    if (groupKey && seenGroups.has(groupKey)) continue;
    if (groupKey) seenGroups.add(groupKey);

    const question = fieldLabel(field);
    const normalized = normalize(question);
    if (question.length < 3 || question.length > 500 || IDENTITY_FIELD.test(normalized) || seenQuestions.has(normalized)) continue;
    seenQuestions.add(normalized);
    records.push({
      field,
      question,
      normalized,
      fieldType: field instanceof HTMLInputElement ? field.type || 'text' : field.tagName.toLowerCase(),
      options: fieldOptions(field),
      sensitive: SENSITIVE_FIELD.test(question),
    });
  }
  return records;
}

function dispatchKey(field, key, code, keyCode) {
  const eventInit = {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
  };
  field.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  return field.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}

async function comboboxOptions(field) {
  field.focus({ preventScroll: true });
  dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(50);
    const options = Array.from(document.querySelectorAll('[role="option"]'))
      .filter(isVisible)
      .map((option) => cleanLabel(option.textContent))
      .filter(Boolean);
    if (options.length) {
      dispatchKey(field, 'Escape', 'Escape', 27);
      field.blur();
      return [...new Set(options)];
    }
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return [];
}

function dayforcePhoneCountryCode(field) {
  return field.closest('.ant-form-item')
    ?.querySelector('input[type="hidden"][id$="PhoneCountryCode"]');
}

function ownedComboboxList(field) {
  const listId = field.getAttribute('aria-controls') || field.getAttribute('aria-owns');
  if (!listId) return null;
  const list = document.getElementById(listId);
  return list instanceof HTMLElement ? list : null;
}

function dayforcePhoneCountryList(field) {
  return ownedComboboxList(field);
}

function optionValues(option) {
  if (!(option instanceof HTMLElement)) return [];
  return [
    option.getAttribute('aria-label'),
    option.getAttribute('title'),
    option.textContent,
  ].map(normalize).filter(Boolean);
}

function isUnitedStatesCountryOption(option) {
  if (!(option instanceof HTMLElement)) return false;
  return optionValues(option).some((value) => /(?:^| )united states of america(?: |$)/.test(value));
}

function dayforceUnitedStatesOption(field) {
  return Array.from(dayforcePhoneCountryList(field)?.querySelectorAll('[role="option"]') || [])
    .find(isUnitedStatesCountryOption) || null;
}

function isDayforceUnitedStatesSelected(field) {
  const list = dayforcePhoneCountryList(field);
  if (list) {
    const selectedOption = Array.from(list.querySelectorAll('[role="option"][aria-selected="true"]'))
      .find(isUnitedStatesCountryOption);
    if (selectedOption) return true;

    // If another exact country option is selected, do not trust a stale hidden
    // input or the displayed +1 code (Canada and several territories share it).
    if (list.querySelector('[role="option"][aria-selected="true"]')) return false;
  }

  const hiddenCountryCode = dayforcePhoneCountryCode(field);
  return hiddenCountryCode instanceof HTMLInputElement
    && hiddenCountryCode.value.toUpperCase() === 'US';
}

async function typeComboboxSearch(field, value) {
  field.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return;

  setter.call(field, '');
  field.dispatchEvent(new InputEvent('input', {
    bubbles: true, composed: true, inputType: 'deleteContentBackward', data: null,
  }));

  let typed = '';
  for (const character of value) {
    const keyCode = character.toUpperCase().charCodeAt(0);
    field.dispatchEvent(new KeyboardEvent('keydown', {
      key: character, code: `Key${character.toUpperCase()}`, keyCode, which: keyCode,
      bubbles: true, cancelable: true,
    }));
    typed += character;
    setter.call(field, typed);
    field.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, inputType: 'insertText', data: character,
    }));
    field.dispatchEvent(new KeyboardEvent('keyup', {
      key: character, code: `Key${character.toUpperCase()}`, keyCode, which: keyCode,
      bubbles: true, cancelable: true,
    }));
    await sleep(15);
  }
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickComboboxOption(option) {
  option.scrollIntoView({ block: 'nearest' });
  for (const [type, buttons] of [['pointerdown', 1], ['mousedown', 1], ['pointerup', 0], ['mouseup', 0]]) {
    const EventConstructor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    option.dispatchEvent(new EventConstructor(type, {
      bubbles: true, cancelable: true, button: 0, buttons, view: window,
    }));
  }
  option.click();
}

async function fillDayforcePhoneCountry(field, answer) {
  if (!/^(?:united states(?: of america)?|usa|us)$/i.test(cleanText(answer))) return false;
  if (isDayforceUnitedStatesSelected(field)) return true;

  field.focus();
  dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);
  await sleep(200);

  // Dayforce links each phone combobox to its own complete option list through
  // aria-controls/aria-owns. Select the exact country in that list rather than
  // searching all visible options or relying on the ambiguous +1 dial code.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const option = dayforceUnitedStatesOption(field);
    if (option instanceof HTMLElement) {
      clickComboboxOption(option);
      await sleep(250);
      if (isDayforceUnitedStatesSelected(field)
          || option.getAttribute('aria-selected') === 'true') {
        field.blur();
        return true;
      }
    }
    await sleep(100);
  }

  // Some Dayforce versions mount their virtual list only after search input.
  // Keep this fallback scoped to the list owned by this exact combobox.
  await typeComboboxSearch(field, 'United States of America');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(100);
    const option = dayforceUnitedStatesOption(field);
    if (option instanceof HTMLElement) {
      clickComboboxOption(option);
      await sleep(250);
      if (isDayforceUnitedStatesSelected(field)
          || option.getAttribute('aria-selected') === 'true') {
        field.blur();
        return true;
      }
    }
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
}

function dayforceAddressExpectedValues(field, answer) {
  const expected = normalize(answer);
  if (
    field.id === 'jobPostingApplication_personalInfo_countryCode'
    && /^(?:united states(?: of america)?|usa|us)$/.test(expected)
  ) {
    return ['united states of america', 'united states'];
  }
  return expected ? [expected] : [];
}

function dayforceAddressOption(field, answer) {
  const expectedValues = dayforceAddressExpectedValues(field, answer);
  return Array.from(ownedComboboxList(field)?.querySelectorAll('[role="option"]') || [])
    .find((option) => optionValues(option).some((value) => expectedValues.includes(value))) || null;
}

function isDayforceAddressSelected(field, answer) {
  const expectedValues = dayforceAddressExpectedValues(field, answer);
  const list = ownedComboboxList(field);
  const selectedOption = list?.querySelector('[role="option"][aria-selected="true"]');
  if (selectedOption) {
    return optionValues(selectedOption).some((value) => expectedValues.includes(value));
  }

  const selectedItem = field.closest('.ant-select')?.querySelector('.ant-select-selection-item');
  return optionValues(selectedItem).some((value) => expectedValues.includes(value));
}

async function fillDayforceAddressCombobox(field, answer) {
  if (isDayforceAddressSelected(field, answer)) return true;

  field.focus();
  dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);
  await sleep(200);

  const chooseExactOption = async () => {
    const option = dayforceAddressOption(field, answer);
    if (!(option instanceof HTMLElement)) return false;
    clickComboboxOption(option);
    await sleep(300);
    return isDayforceAddressSelected(field, answer)
      || option.getAttribute('aria-selected') === 'true';
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await chooseExactOption()) {
      field.blur();
      return true;
    }
    await sleep(100);
  }

  const searchValue = field.id === 'jobPostingApplication_personalInfo_countryCode'
    && /^(?:united states(?: of america)?|usa|us)$/i.test(cleanText(answer))
    ? 'United States of America'
    : answer;
  await typeComboboxSearch(field, searchValue);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(100);
    if (await chooseExactOption()) {
      field.blur();
      return true;
    }
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
}

async function extractPage() {
  const description = extractJobDescription();
  const header = extractJobHeader();
  const fields = extractFields();
  for (const record of fields) {
    if (!record.sensitive && record.field instanceof HTMLInputElement && record.field.getAttribute('role') === 'combobox') {
      record.options = await comboboxOptions(record.field);
      record.fieldType = 'combobox';
    }
  }
  const descriptionParts = [];
  if (header.title && !normalize(description.text).startsWith(normalize(header.title))) descriptionParts.push(header.title);
  if (header.location && !normalize(description.text).includes(normalize(header.location))) descriptionParts.push(header.location);
  if (header.attributes.length) {
    descriptionParts.push(header.attributes.map(({ label, value }) => `${label}: ${value}`).join('\n'));
  }
  if (description.text) descriptionParts.push(description.text);
  return {
    url: location.href,
    title: document.title,
    jobTitle: header.title,
    jobDescription: descriptionParts.join('\n\n').slice(0, 20000),
    jobDescriptionSource: description.source,
    questions: fields.map(({ question, fieldType, options, sensitive }) => ({
      question,
      fieldType,
      options,
      sensitive,
    })),
  };
}

function setNativeValue(field, value, blur = true) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  if (blur) field.dispatchEvent(new Event('blur', { bubbles: true }));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fillCombobox(field, answer) {
  if (
    /country dialing code/i.test(field.getAttribute('aria-label') || '')
    && field.closest('.ant-select[test-id$="-phone-dropdown"]')
  ) {
    return fillDayforcePhoneCountry(field, answer);
  }
  if (
    field.closest('.ant-select')
    && /_personalInfo_(?:countryCode|stateCode)$/.test(field.id)
  ) {
    return fillDayforceAddressCombobox(field, answer);
  }
  field.focus();
  const visibleOptions = () => Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible);
  const matchingOption = (options = visibleOptions()) => {
    const optionText = bestOption(options.map((option) => cleanText(option.textContent)), answer);
    return options.find((item) => cleanText(item.textContent) === optionText);
  };
  const selectedValueMatches = () => {
    if (/country dialing code/i.test(field.getAttribute('aria-label') || '') && /^(?:united states|usa|us)$/i.test(cleanText(answer))) {
      const countryCode = field.closest('.ant-form-item')?.querySelector('input[type="hidden"][id$="PhoneCountryCode"]')?.value;
      if (String(countryCode || '').toUpperCase() === 'US') return true;
    }
    const control = field.closest('.ant-select, .select__control, .Select-control, [class*="-control"]') || field.parentElement;
    const selected = control?.querySelector('.ant-select-selection-item, .select__single-value, .Select-value-label, [class*="singleValue"]');
    const selectedValue = normalize(selected?.textContent);
    const expectedValue = normalize(answer);
    if (!selectedValue || !expectedValue) return false;
    return selectedValue === expectedValue
      || selectedValue.includes(expectedValue)
      || expectedValue.includes(selectedValue);
  };
  const selectionPersistsAfterBlur = async () => {
    if (!selectedValueMatches()) return false;
    field.blur();
    await sleep(150);
    return selectedValueMatches();
  };
  const chooseOption = async () => {
    const options = visibleOptions();
    const option = matchingOption(options);
    if (!(option instanceof HTMLElement)) return false;

    const legacyReactSelect = Boolean(field.closest('.Select-control'));
    if (legacyReactSelect) {
      // React Select v1 commits options on mousedown. Keyboard navigation is unsafe here
      // because opening the list already advances its focused option by one.
      option.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, view: window,
      }));
      await sleep(250);
      return selectionPersistsAfterBlur();
    }

    // React Select commits an option in its onClick handler. Calling mousedown first removes
    // the menu on blur before that handler runs, leaving only temporary input text.
    option.click();
    await sleep(250);
    if (await selectionPersistsAfterBlur()) return true;

    // Keyboard fallback for combobox implementations without an option click handler.
    field.focus();
    dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);
    await sleep(100);
    const reopenedOptions = visibleOptions();
    const reopenedOption = matchingOption(reopenedOptions);
    if (!(reopenedOption instanceof HTMLElement)) return false;
    const optionIndex = reopenedOptions.indexOf(reopenedOption);
    for (let index = 0; index < optionIndex; index += 1) {
      dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);
      await sleep(10);
    }
    dispatchKey(field, 'Enter', 'Enter', 13);
    await sleep(200);
    return selectionPersistsAfterBlur();
  };

  // Greenhouse uses React Select. ArrowDown opens it without blurring the hidden text input.
  dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);
  await sleep(125);
  let option = matchingOption();
  if (option instanceof HTMLElement) return chooseOption();

  // Filter long lists such as country. Do not dispatch blur until an option is selected.
  setNativeValue(field, answer, false);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    option = matchingOption();
    if (option instanceof HTMLElement) {
      // React Select focuses the first matching result when its input filter changes.
      return chooseOption();
    }
  }

  setNativeValue(field, '', false);
  field.blur();
  return false;
}

async function fillInternationalPhoneCountry(field, answer) {
  const currentCountry = cleanText(field.getAttribute('title'));
  if (normalize(currentCountry) === normalize(answer)) return true;
  field.click();
  await sleep(150);
  const listId = field.getAttribute('aria-controls');
  const container = listId ? document.getElementById(listId) : document;
  const options = Array.from(container?.querySelectorAll('[role="option"]') || []).filter(isVisible);
  const countryNames = options.map((option) => cleanText(option.querySelector('.iti__country-name')?.textContent || option.textContent));
  const selectedName = bestOption(countryNames, answer);
  const option = options.find((item) => cleanText(item.querySelector('.iti__country-name')?.textContent || item.textContent) === selectedName);
  if (!(option instanceof HTMLElement)) return false;
  option.click();
  await sleep(150);
  const selectedCountry = normalize(field.getAttribute('title'));
  const expectedCountry = normalize(answer);
  return selectedCountry === expectedCountry
    || selectedCountry.includes(expectedCountry)
    || expectedCountry.includes(selectedCountry);
}

function isWorkdayPage() {
  return /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/i.test(location.hostname);
}

async function fillWorkdayListboxButton(field, answer) {
  const expected = normalize(answer);
  if (!expected) return false;
  if (normalize(field.textContent) === expected) return true;

  field.focus();
  field.click();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    const options = Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible);
    const optionText = bestOption(options.map((option) => cleanText(option.textContent)), answer);
    const option = options.find((item) => cleanText(item.textContent) === optionText);
    if (!(option instanceof HTMLElement)) continue;

    option.click();
    await sleep(250);
    return normalize(field.textContent) === expected
      || normalize(field.getAttribute('aria-label')).includes(expected);
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
}

function bestOption(options, answer) {
  const normalizedAnswer = normalize(answer);
  const usableOptions = options.filter((option) => normalize(option));
  return usableOptions.find((option) => normalize(option) === normalizedAnswer)
    || usableOptions.find((option) => normalizedAnswer.includes(normalize(option)) || normalize(option).includes(normalizedAnswer));
}

async function fillField(record, answer) {
  const { field } = record;
  if (field instanceof HTMLInputElement && field.getAttribute('role') === 'combobox') {
    return fillCombobox(field, answer);
  }
  if (field.getAttribute('role') === 'combobox' && field.matches('.iti__selected-flag')) {
    return fillInternationalPhoneCountry(field, answer);
  }
  if (field.matches('button[aria-haspopup="listbox"]')) {
    return isWorkdayPage() ? fillWorkdayListboxButton(field, answer) : false;
  }
  if (field instanceof HTMLSelectElement) {
    const enabledOptions = Array.from(field.options).filter((option) => option.value && !option.disabled);
    const optionText = bestOption(enabledOptions.map((option) => option.textContent || ''), answer);
    const option = enabledOptions.find((item) => item.textContent === optionText);
    if (!option) return false;
    field.value = option.value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (field instanceof HTMLInputElement && field.type === 'radio') {
    const candidates = Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter((candidate) =>
      candidate instanceof HTMLInputElement && candidate.type === 'radio' && candidate.name === field.name,
    );
    const optionText = bestOption(candidates.map(optionLabel), answer);
    const candidate = candidates.find((item) => optionLabel(item) === optionText);
    if (!(candidate instanceof HTMLInputElement)) return false;
    candidate.click();
    return true;
  }
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    const unnamedCheckboxGroup = !field.name
      ? field.closest('fieldset[data-automation-id$="-CheckboxGroup"]')
      : null;
    const candidates = field.name
      ? Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter((candidate) =>
          candidate instanceof HTMLInputElement && candidate.type === 'checkbox' && candidate.name === field.name,
        )
      : Array.from(unnamedCheckboxGroup?.querySelectorAll('input[type="checkbox"]') || [field]);
    if (candidates.length > 1) {
      const normalizedAnswer = normalize(answer);
      const matches = candidates.filter((candidate) => normalizedAnswer.includes(normalize(optionLabel(candidate))));
      if (!matches.length) return false;
      for (const candidate of candidates) {
        const shouldCheck = matches.includes(candidate);
        if (candidate.checked !== shouldCheck) candidate.click();
      }
      return true;
    }
    const affirmative = /^(yes|true|i agree|agree|checked)$/i.test(cleanText(answer));
    if (field.checked !== affirmative) field.click();
    return true;
  }
  if (field instanceof HTMLInputElement && field.type === 'date') return false;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    setNativeValue(field, answer);
    return true;
  }
  return false;
}

function splitFullName(fullName) {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function phoneValueForField(phone, country, field) {
  const value = cleanText(phone);
  if (!value) return value;
  const digits = value.replace(/\D/g, '');
  const workdayPhoneGroup = isWorkdayPage()
    ? field?.closest('[data-fkit-id="phoneNumber--null"]')
    : null;
  const workdayCountryField = workdayPhoneGroup
    ?.querySelector('[data-automation-id="formField-countryPhoneCode"]');
  if (workdayCountryField) {
    const selectedCountry = workdayCountryField.querySelector([
      '[data-automation-id="selectedItem"]',
      '[data-automation-id="promptAriaInstruction"]',
    ].join(','));
    const selectedText = cleanText([
      selectedCountry?.getAttribute('aria-label'),
      selectedCountry?.textContent,
    ].filter(Boolean).join(' '));
    const selectedDialCode = selectedText.match(/\(\s*\+(\d+)\s*\)|\+(\d+)/)?.slice(1).find(Boolean)
      || (/^(?:united states|usa|us)$/i.test(cleanText(country)) ? '1' : '');
    if (selectedDialCode && value.trim().startsWith(`+${selectedDialCode}`)) {
      return value.trim().slice(selectedDialCode.length + 1).replace(/^[\s.-]+/, '').trim();
    }
  }
  const separateAntDialCode = field?.closest('.ant-space-compact')?.querySelector('input[aria-label="Country dialing code"]');
  if (separateAntDialCode && /^(?:united states|usa|us)$/i.test(cleanText(country))) {
    if (!isDayforceUnitedStatesSelected(separateAntDialCode)) return '';
    return value.replace(/^\s*\+1[\s.-]*/, '').trim();
  }
  const separateDialCode = field?.closest('.iti--separate-dial-code');
  if (separateDialCode) {
    const dialCode = cleanText(separateDialCode.querySelector('.iti__selected-dial-code')?.textContent).replace(/\D/g, '');
    if (value.trim().startsWith('+') && dialCode && digits.startsWith(dialCode)) return digits.slice(dialCode.length);
    if (dialCode === '1' && digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return value;
  }
  if (location.hostname !== 'job-boards.greenhouse.io') return value;
  if (!/^(?:united states|usa|us)$/i.test(cleanText(country))) return value;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : value;
}

function workableLocationValue(identity, profile) {
  if (!location.hostname.endsWith('workable.com')) return '';
  const savedLocation = cleanText(profile?.location);
  if (!savedLocation) return '';
  const parts = savedLocation.split(',').map(cleanText).filter(Boolean);
  const city = parts[0] || savedLocation;
  const state = parts[1] || '';
  const country = cleanText(profile?.country);

  if (/\b(address|current location|where.*located)\b/.test(identity)) {
    return country && !normalize(savedLocation).includes(normalize(country))
      ? `${savedLocation}, ${country}`
      : savedLocation;
  }
  if (/\b(city|town)\b/.test(identity)) return city;
  if (/\b(state|province|region)\b/.test(identity)) return state;
  return '';
}

function canonicalCountry(value) {
  const normalized = normalize(value);
  if (/^(?:us|usa|united states|united states of america)$/.test(normalized)) return 'United States';
  return cleanText(value);
}

function canonicalUsState(value) {
  const states = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  };
  const cleaned = cleanText(value);
  return states[cleaned.toUpperCase()] || cleaned;
}

function combinedWorkAuthorizationValue(identity, profile) {
  const asksWithoutSponsorship = /without(?:\s+\w+){0,4}\s+sponsorship|(?:do|will|would) not require(?:\s+\w+){0,4}\s+sponsorship|no(?:\s+\w+){0,3}\s+sponsorship/.test(identity);
  const asksAbilityToWork = /authorized to work|legally authorized|able to work|eligible to work|work in the (?:us|united states)/.test(identity);
  if (!asksWithoutSponsorship || !asksAbilityToWork) return '';

  const sponsorship = normalize(profile?.requiresSponsorship);
  const authorization = normalize(profile?.legallyAuthorizedUs);
  if (!['yes', 'no'].includes(sponsorship) || !['yes', 'no'].includes(authorization)) return '';

  const asksUsLocation = /\blocated\b/.test(identity);
  const country = normalize(profile?.country);
  const locatedInUs = !asksUsLocation || /^(?:united states(?: of america)?|usa|us)$/.test(country);
  return sponsorship === 'no' && authorization === 'yes' && locatedInUs ? 'Yes' : 'No';
}

function profileValueForField(field, profile) {
  const label = normalize(fieldLabel(field));
  const identity = normalize([
    field.id,
    field.getAttribute('name'),
    field.getAttribute('autocomplete'),
    label,
  ].filter(Boolean).join(' '));
  const names = splitFullName(profile?.fullName);
  const workableLocation = workableLocationValue(identity, profile);
  const combinedWorkAuthorization = combinedWorkAuthorizationValue(identity, profile);

  if (/\b(first|given) name\b|\bgiven name\b|\bgiven name$/.test(identity) || field.autocomplete === 'given-name') return names.firstName;
  if (/\b(last|family|surname) name\b|\bfamily name\b/.test(identity) || field.autocomplete === 'family-name') return names.lastName;
  if (/\bfull name\b|\blegal name\b|\bsystemfield name\b/.test(identity) || label === 'name' || field.autocomplete === 'name') return profile?.fullName;
  if (/\be ?mail\b/.test(identity) || field.autocomplete === 'email') return profile?.email;
  if (/\bphone (?:device )?type\b|\bphonetype\b/.test(identity)) return 'Mobile';
  if (/\bphone extension\b|\bextension\b/.test(identity)) return '';
  if (/phone.*country|telephone country code/.test(identity)) return canonicalCountry(profile?.country);
  if (/\b(phone|mobile|tel)\b/.test(identity) || field.autocomplete === 'tel') return phoneValueForField(profile?.phone, profile?.country, field);
  if (/\blinkedin\b/.test(identity)) return profile?.linkedin;
  if (combinedWorkAuthorization) return combinedWorkAuthorization;
  // Compound ATS identifiers often contain an address index before the actual
  // component, such as `work-history-address-1-zip`. Match components first.
  if (/\b(zip|postal code|postcode)\b/.test(identity)) return profile?.zip;
  if (/\b(city|town)\b/.test(identity)) return profile?.city;
  if (/\bcounty\b/.test(identity)) return profile?.county;
  if (/\b(state|province|region)\b/.test(identity)) return canonicalUsState(profile?.state);
  if (/\baddress\s*(?:line\s*)?(?:1|one)\b|\baddressline1\b|\bstreet address\b/.test(identity)) return profile?.address1;
  if (workableLocation) return workableLocation;
  if (/\b(country|country code)\b/.test(identity) || field.autocomplete === 'country') return canonicalCountry(profile?.country);
  if (/candidate location|location city|\blocation\b/.test(identity)) return profile?.location;
  if (/sponsorship/.test(identity)) return profile?.requiresSponsorship;
  if (/legally authorized|authorized to work|work authorization/.test(identity)) return profile?.legallyAuthorizedUs;
  if (/hispanic|latino/.test(identity)) return profile?.hispanicLatino;
  if (/\b(gender|sex)\b/.test(identity)) return profile?.gender;
  if (/\b(race|ethnicity)\b/.test(identity)) return profile?.ethnicity;
  if (isWorkdayPage() && /\b(disability|disabled)\b/.test(identity)) {
    return 'No, I do not have a disability and have not had one in the past';
  }
  if (/\bveteran\b/.test(identity)) {
    return isWorkdayPage() ? 'I am not a veteran' : 'I am not a protected veteran';
  }
  if (/subscribe|contact preference|text message|job alert|new opportunities/.test(identity)) return 'No';
  return '';
}

async function fillProfileFields(profile) {
  let filled = 0;
  const filledQuestions = [];
  const skippedQuestions = [];
  const seen = new Set();
  // Greenhouse reveals dependent fields after earlier answers (for example, Race after
  // Hispanic/Latino = No). Rescan between passes so those newly mounted controls are included.
  for (let pass = 0; pass < 4; pass += 1) {
    for (const field of document.querySelectorAll(FIELD_SELECTOR)) {
      if (!isVisible(field) || field.disabled || field.readOnly || seen.has(field)) continue;
      seen.add(field);
      const value = cleanText(profileValueForField(field, profile));
      const question = fieldLabel(field) || field.id || field.getAttribute('name') || 'Profile field';
      const identity = normalize([field.id, field.getAttribute('name'), question].filter(Boolean).join(' '));
      if (!value) {
        if (
          /\bphone extension\b|\bextension\b/.test(identity)
          && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
          && field.value
        ) {
          setNativeValue(field, '');
          filled += 1;
          filledQuestions.push(question);
        }
        continue;
      }
      const record = { field, question, normalized: normalize(question), sensitive: SENSITIVE_FIELD.test(question) };
      if (await fillField(record, value)) {
        filled += 1;
        filledQuestions.push(question);
      }
      else skippedQuestions.push(question);
      await sleep(100);
    }
    if (pass < 3) await sleep(250);
  }
  return { filled, filledQuestions, skippedQuestions };
}

async function fillCoverLetterField(coverLetterText) {
  const value = String(coverLetterText || '').trim();
  if (!value) return { filled: 0, filledQuestions: [], skippedQuestions: [] };
  for (const field of document.querySelectorAll(FIELD_SELECTOR)) {
    if (!isVisible(field) || field.disabled || field.readOnly) continue;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    const question = fieldLabel(field) || field.id || field.getAttribute('name') || '';
    if (!/\bcover letter\b/i.test(cleanLabel(question).replace(/[_-]+/g, ' '))) continue;
    const record = { field, question, normalized: normalize(question), sensitive: false };
    return await fillField(record, value)
      ? { filled: 1, filledQuestions: [question], skippedQuestions: [] }
      : { filled: 0, filledQuestions: [], skippedQuestions: [question] };
  }
  return { filled: 0, filledQuestions: [], skippedQuestions: [] };
}

async function fillAnswers(answers, profile, coverLetterText) {
  const records = extractFields();
  const profileResult = await fillProfileFields(profile || {});
  const coverLetterResult = await fillCoverLetterField(coverLetterText);
  let filled = profileResult.filled + coverLetterResult.filled;
  const filledQuestions = [...profileResult.filledQuestions, ...coverLetterResult.filledQuestions];
  const skippedQuestions = [...profileResult.skippedQuestions, ...coverLetterResult.skippedQuestions];
  for (const item of Array.isArray(answers) ? answers : []) {
    const question = cleanLabel(item?.question);
    const answer = cleanText(item?.answer);
    if (!question || !answer) continue;
    const target = records.find((record) => record.normalized === normalize(question))
      || records.find((record) => record.normalized.includes(normalize(question)) || normalize(question).includes(record.normalized));
    if (!target || target.sensitive || !await fillField(target, answer)) {
      skippedQuestions.push(question);
      continue;
    }
    filled += 1;
    filledQuestions.push(question);
  }
  return { filled, skipped: skippedQuestions.length, filledQuestions, skippedQuestions };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === RESUME_AI_EXTRACT_PAGE) {
    extractPage().then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : 'Page extraction failed' });
    });
    return true;
  }
  if (message?.type === RESUME_AI_FILL_ANSWERS) {
    fillAnswers(message.answers, message.profile, message.coverLetterText).then(sendResponse).catch((error) => {
      sendResponse({ filled: 0, skipped: 1, filledQuestions: [], skippedQuestions: [error instanceof Error ? error.message : 'Autofill failed'] });
    });
    return true;
  }
});
