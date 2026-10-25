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
  '.iCIMS_Header',
  '[data-automation-id="jobPostingHeader"]',
  '[data-testid="job-title"]',
  '[data-ui="overview-title"]',
  '.posting-headline h2',
  'main h1',
  'h1',
];

const COMPANY_SELECTORS = [
  '[data-ui="overview-company"] a',
  '[data-ui="overview-company"]',
  '[data-testid="company-name"]',
  '[data-ui="company-name"]',
  '.posting-headline .company-name',
];

const LOCATION_SELECTORS = [
  '.job__location',
  '.iCIMS_JobsTable .header.left > .field-label + span',
  '[data-automation-id="locations"]',
  '[data-testid="job-location"]',
  '[data-ui="job-location"]',
  '[data-ui="overview-location"]',
  '.posting-categories .location',
];

const JOB_ATTRIBUTE_SELECTORS = [
  { key: 'workplace', label: 'Workplace', sectionLabels: ['Location Type', 'Workplace'], selectors: ['[data-automation-id="remoteType"]', '[data-ui="job-workplace"]', '[data-testid="job-workplace"]', '[data-ui="overview-workplace"]', '.posting-categories .workplaceTypes'] },
  { key: 'department', label: 'Department', sectionLabels: ['Department'], selectors: ['[data-ui="job-department"]', '[data-testid="job-department"]', '[data-ui="overview-department"]', '.posting-categories .department'] },
  { key: 'employmentType', label: 'Employment Type', sectionLabels: ['Employment Type'], selectors: ['[data-ui="job-type"]', '[data-testid="job-type"]', '[data-ui="overview-employment-type"]', '.posting-categories .commitment'] },
  { key: 'compensation', label: 'Salary', sectionLabels: ['Salary', 'Compensation'], selectors: ['[data-ui="job-compensation"]', '[data-testid="job-compensation"]'] },
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
  '[role="radio"]',
  'button[aria-haspopup="listbox"]',
  'button[class*="inputGroupEligible"]',
].join(',');

const TEXT_ENTRY_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'number', 'email']);

function isTextEntryField(field) {
  if (field instanceof HTMLTextAreaElement) return true;
  if (!(field instanceof HTMLInputElement)) return false;
  return TEXT_ENTRY_INPUT_TYPES.has(String(field.type || '').toLowerCase());
}

const IDENTITY_FIELD = /^(?:(?:legal |preferred )?(?:first|given|preferred|middle|last|family|full) name(?: legal| preferred)?|e-?mail(?: address)?|phone(?: number)?|phone (?:device )?type|phone extension|mobile(?: phone| number)?|street address|address(?: line)? [12]|city|location(?: city)?|candidate location|state|state province|province|county|postal code|zip(?: postal)?(?: code)?|country(?: of residence)?|resume|upload resume|cover letter|linkedin(?: profile| url)?|website|portfolio(?: url)?|search|subscribe(?: to job alerts)?|.*notify me of new opportunities.*|.*text message updates.*|opt in text messaging)$/i;
const SENSITIVE_FIELD = /\b(?:race|ethnicity|gender|sex|sexual orientation|hispanic|latino|veteran|disability|disabled|religion|marital|pregnancy|pregnant|medical|health|age|social security|ssn|national id|pronoun|pronouns|salary history|current salary|sponsorship|citizenship|citizen|green card|permanent resident|immigration status)\b|date of birth|birth date|voluntary self.identification|legally authorized|authorized to work|right to work|work authorization/i;

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
    .replace(/\s+is required\s*$/i, '')
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
      if (posting) return posting;
    } catch {
      // Ignore malformed metadata and continue with visible HTML.
    }
  }
  return null;
}

function structuredDescription(posting) {
  if (!posting?.description) return '';
  const parser = new DOMParser();
  const parsed = parser.parseFromString(String(posting.description), 'text/html');
  const description = cleanText(parsed.body.innerText || parsed.body.textContent);
  return description.length >= 120 ? description.slice(0, 50000) : '';
}

function structuredName(value) {
  return cleanText(typeof value === 'string' ? value : value?.name);
}

function assignedJsonObject(text, assignmentPattern) {
  const assignment = assignmentPattern.exec(String(text || ''));
  if (!assignment) return null;
  const start = String(text).indexOf('{', assignment.index + assignment[0].length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function phenomJobData() {
  for (const script of document.querySelectorAll('script')) {
    const data = assignedJsonObject(script.textContent, /(?:window\.)?phApp\.ddo\s*=\s*/);
    const job = data?.jobDetail?.data?.job;
    if (job && typeof job === 'object') return job;
  }
  return null;
}

function phenomLocation() {
  const job = phenomJobData();
  if (!job) return '';
  const locations = Array.isArray(job.multi_location) && job.multi_location.length
    ? job.multi_location
    : Array.isArray(job.standardised_multi_location)
      ? job.standardised_multi_location
      : [];
  const locationValues = locations.map((item) => cleanText(
    item?.location
    || item?.cityStateCountry
    || item?.standardisedMapQueryLocation
    || [item?.cityState, item?.country].filter(Boolean).join(', '),
  )).filter(Boolean);
  if (locationValues.length) {
    return [...new Map(locationValues.map((value) => [normalize(value), value])).values()].join('; ');
  }
  return cleanText(job.location
    || job.cityStateCountry
    || [job.cityState, job.country].filter(Boolean).join(', '));
}

function ripplingJobHeader() {
  if (!/(^|\.)ats\.rippling\.com$/i.test(location.hostname)) return null;
  const script = document.getElementById('__NEXT_DATA__');
  if (!script?.textContent) return null;
  try {
    const apiData = JSON.parse(script.textContent)?.props?.pageProps?.apiData;
    const jobPost = apiData?.jobPost;
    if (!jobPost || typeof jobPost !== 'object') return null;
    const workLocations = Array.isArray(jobPost.workLocations) && jobPost.workLocations.length
      ? jobPost.workLocations
      : apiData.workLocations;
    const locationValue = Array.isArray(workLocations)
      ? workLocations.map((item) => cleanText(typeof item === 'string' ? item : item?.name)).filter(Boolean).join('; ')
      : cleanText(workLocations);
    return {
      title: cleanText(jobPost.name),
      company: cleanText(jobPost.companyName),
      location: locationValue,
    };
  } catch {
    return null;
  }
}

function structuredLocation(posting) {
  const locations = Array.isArray(posting?.jobLocation) ? posting.jobLocation : [posting?.jobLocation];
  for (const locationValue of locations) {
    const address = locationValue?.address || locationValue;
    const locationText = [
      structuredName(address?.addressLocality),
      structuredName(address?.addressRegion),
      structuredName(address?.addressCountry),
    ].filter(Boolean).join(', ');
    if (locationText) return locationText;
  }
  if (normalize(posting?.jobLocationType) === 'telecommute') {
    const requirements = Array.isArray(posting?.applicantLocationRequirements)
      ? posting.applicantLocationRequirements
      : [posting?.applicantLocationRequirements];
    for (const requirement of requirements) {
      const rawRegion = structuredName(requirement);
      if (!rawRegion) continue;
      let region = rawRegion;
      if (/^[a-z]{2}$/i.test(rawRegion)) {
        try {
          region = new Intl.DisplayNames(['en'], { type: 'region' }).of(rawRegion.toUpperCase()) || rawRegion;
        } catch {
          // Keep the supplied region code when DisplayNames is unavailable.
        }
      }
      return `Remote (${region})`;
    }
  }
  return '';
}

function structuredWorkplace(posting) {
  if (normalize(posting?.jobLocationType) !== 'telecommute') return '';
  if (/\/(?:view\/[^/]+\/)?hybrid-/i.test(location.pathname)) return 'Hybrid';
  const description = structuredDescription(posting);
  if (/\bhybrid(?:[- ](?:work|working|workplace|role|position|schedule|model|arrangement|environment))?\b/i.test(description)) {
    return 'Hybrid';
  }
  return 'Remote';
}

function structuredEmploymentType(posting) {
  const rawValue = Array.isArray(posting?.employmentType) ? posting.employmentType[0] : posting?.employmentType;
  const normalized = normalize(rawValue).replace(/ /g, '_');
  const labels = {
    full_time: 'Full-time',
    part_time: 'Part-time',
    contractor: 'Contract',
    temporary: 'Temporary',
    intern: 'Internship',
    volunteer: 'Volunteer',
    per_diem: 'Per diem',
    other: 'Other',
  };
  return labels[normalized] || cleanText(rawValue);
}

function structuredCompensation(posting) {
  const salary = Array.isArray(posting?.baseSalary) ? posting.baseSalary[0] : posting?.baseSalary;
  const value = salary?.value;
  if (!value) return '';
  const currency = cleanText(salary.currency || value.currency || 'USD').toUpperCase();
  const formatAmount = (amount) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return '';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(numericAmount);
    } catch {
      return `${currency} ${numericAmount.toLocaleString('en-US')}`;
    }
  };
  const minimum = formatAmount(value.minValue);
  const maximum = formatAmount(value.maxValue);
  const exact = formatAmount(value.value);
  const amount = minimum && maximum ? `${minimum} – ${maximum}` : minimum || maximum || exact;
  const period = cleanText(value.unitText).toLowerCase();
  return amount ? `${amount}${period ? ` per ${period}` : ''}` : '';
}

function cleanJobAttributeValue(key, value) {
  const cleaned = cleanText(value).replace(/\s*\/\s*$/, '');
  if (key === 'workplace') {
    return cleaned.replace(/^(?:remote type|location type|workplace)\s*:?\s*/i, '');
  }
  return cleaned;
}

function cleanJobLocationValue(value) {
  const cleaned = cleanText(value).replace(/\s*\/\s*$/, '');
  return /^(?:unavailable|unknown|n\/?a|not specified)(?:\s*,.*)?$/i.test(cleaned) ? '' : cleaned;
}

function iCimsHeaderValue(label) {
  const expectedLabel = normalize(label);
  for (const item of document.querySelectorAll('.iCIMS_JobHeaderTag')) {
    const itemLabel = normalize(item.querySelector('.iCIMS_JobHeaderField')?.textContent);
    if (itemLabel !== expectedLabel) continue;
    return cleanText(item.querySelector('.iCIMS_JobHeaderData')?.innerText
      || item.querySelector('.iCIMS_JobHeaderData')?.textContent);
  }
  return '';
}

function extractICimsJobDescription() {
  const sections = [];
  for (const heading of document.querySelectorAll('.iCIMS_JobContent h2.iCIMS_InfoField_Job')) {
    if (!isVisible(heading)) continue;
    let content = heading.nextElementSibling;
    while (content && !content.matches('.iCIMS_InfoMsg_Job')) {
      if (content.matches('h2.iCIMS_InfoField_Job')) break;
      content = content.nextElementSibling;
    }
    if (!(content instanceof HTMLElement) || !isVisible(content)) continue;
    const headingText = cleanText(heading.innerText || heading.textContent);
    const contentText = cleanText(content.innerText || content.textContent);
    if (headingText && contentText) sections.push(`${headingText}\n${contentText}`);
  }
  const description = sections.join('\n\n');
  return description.length >= 120 ? description.slice(0, 50000) : '';
}

function labeledJobSections() {
  const sections = new Map();
  for (const container of document.querySelectorAll('.ashby-job-posting-left-pane')) {
    for (const heading of container.querySelectorAll('h2')) {
      const section = heading.parentElement;
      if (!(section instanceof HTMLElement)) continue;
      const label = normalize(heading.textContent);
      const value = cleanText(Array.from(section.children)
        .filter((element) => element !== heading)
        .map((element) => element.innerText || element.textContent)
        .join('\n'));
      if (label && value && !sections.has(label)) sections.set(label, value);
    }
  }
  return sections;
}

function labeledSectionValue(sections, labels) {
  for (const label of labels) {
    const value = sections.get(normalize(label));
    if (value) return value;
  }
  return '';
}

function definitionListValue(labels) {
  const expectedLabels = new Set(labels.map(normalize));
  for (const term of document.querySelectorAll('dt')) {
    if (!expectedLabels.has(normalize(term.innerText || term.textContent))) continue;
    const sibling = term.nextElementSibling;
    const valueElement = sibling?.matches?.('dd') ? sibling : term.parentElement?.querySelector?.('dd');
    if (!(valueElement instanceof HTMLElement) || !isVisible(valueElement)) continue;
    const value = cleanText(valueElement.innerText || valueElement.textContent);
    if (value && value.length <= 300) return value;
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

function extractJobDescription(posting) {
  const iCimsDescription = extractICimsJobDescription();
  if (iCimsDescription) return { text: iCimsDescription, source: 'iCIMS job sections' };

  if (/(^|\.)ats\.rippling\.com$/i.test(location.hostname)) {
    for (const element of document.querySelectorAll('.ATS_htmlPreview')) {
      if (!isVisible(element)) continue;
      const text = cleanText(element.innerText || element.textContent);
      if (text.length >= 120) return { text: text.slice(0, 50000), source: 'Rippling job description' };
    }
  }

  const structured = structuredDescription(posting);
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
  return best?.score >= 90 ? { text: best.text.slice(0, 50000), source: best.source } : { text: '', source: null };
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

function extractJobHeader(posting) {
  const ripplingHeader = ripplingJobHeader();
  const labeledSections = labeledJobSections();
  const structuredAttributes = {
    workplace: structuredWorkplace(posting),
    department: structuredName(posting?.department),
    employmentType: structuredEmploymentType(posting),
    compensation: structuredCompensation(posting),
  };
  const attributes = JOB_ATTRIBUTE_SELECTORS.flatMap(({ key, label, sectionLabels, selectors }) => {
    const value = cleanJobAttributeValue(key, firstVisibleText(selectors)
      || labeledSectionValue(labeledSections, sectionLabels)
      || structuredAttributes[key]);
    return value ? [{ label, value }] : [];
  });
  const company = ripplingHeader?.company
    || firstVisibleText(COMPANY_SELECTORS)
    || iCimsHeaderValue('Brand')
    || structuredName(posting?.hiringOrganization);
  const locationValue = cleanJobLocationValue(ripplingHeader?.location
    || firstVisibleText(LOCATION_SELECTORS)
    || definitionListValue(['Location'])
    || labeledSectionValue(labeledSections, ['Location'])
    || phenomLocation()
    || structuredLocation(posting));
  return {
    title: ripplingHeader?.title || firstVisibleText(TITLE_SELECTORS) || cleanText(posting?.title),
    company: company.replace(/^at\s+/i, ''),
    location: locationValue,
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
  // Lever wraps each control, all of its select options, and sometimes long EEO
  // descriptions in one <label>. Read the dedicated question caption first so
  // fields such as Gender and Race are not represented by that entire wrapper.
  const leverQuestion = field.closest('.application-question')?.querySelector('.application-label');
  const leverQuestionText = cleanLabel(leverQuestion?.innerText || leverQuestion?.textContent);
  if (leverQuestionText) return leverQuestionText;

  // Rippling custom questions place their caption in a sibling block above the
  // combobox, whose own aria-label is only the generic word "Select".
  if (/(?:^|\.)ats\.rippling\.com$/i.test(location.hostname)) {
    const ripplingRadioGroup = field.closest('[role="radiogroup"]');
    const ripplingRadioQuestion = ripplingRadioGroup
      ?.closest('.paddingX--16')
      ?.querySelector(':scope > p');
    const ripplingRadioQuestionText = cleanLabel(
      ripplingRadioQuestion?.innerText || ripplingRadioQuestion?.textContent,
    );
    if (ripplingRadioQuestionText) return ripplingRadioQuestionText;

    const ripplingQuestion = field.closest('.marginY--36')?.querySelector('.paddingX--16 p');
    const ripplingQuestionText = cleanLabel(ripplingQuestion?.innerText || ripplingQuestion?.textContent);
    if (ripplingQuestionText) return ripplingQuestionText;
  }

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
      ':scope > [class*="bodyImportant"]',
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
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelledText = cleanLabel(textFromIds(labelledBy));
    if (labelledText) return labelledText;
  }
  const parentLabel = field.closest('label');
  const parentText = cleanLabel(parentLabel?.innerText || parentLabel?.textContent);
  if (parentText) return parentText;
  return cleanLabel(field.getAttribute('aria-label') || field.textContent || field.value);
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
  field.select?.();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return;

  field.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true, composed: true, inputType: 'deleteContentBackward', data: null,
  }));
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
    field.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, composed: true, inputType: 'insertText', data: character,
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

async function extractPage(includeQuestions = true) {
  const posting = parseJobPostingJsonLd();
  const description = extractJobDescription(posting);
  const header = extractJobHeader(posting);
  const fields = includeQuestions ? extractFields() : [];
  for (const record of fields) {
    if (!record.sensitive && record.field instanceof HTMLInputElement && record.field.getAttribute('role') === 'combobox') {
      record.options = await comboboxOptions(record.field);
      record.fieldType = 'combobox';
    }
  }
  return {
    url: location.href,
    title: document.title,
    jobTitle: header.title,
    jobDescription: composeJobDescription(header, description.text).slice(0, 50000),
    jobDescriptionSource: description.source,
    questions: fields.map(({ question, fieldType, options, sensitive }) => ({
      question,
      fieldType,
      options,
      sensitive,
    })),
  };
}

function composeJobDescription(header, description) {
  const information = [];
  if (header.title) information.push(`Title: ${header.title}`);
  if (header.company) information.push(`Company: ${header.company}`);
  if (header.location) information.push(`Location: ${header.location}`);
  information.push(...header.attributes.map(({ label, value }) => `${label}: ${value}`));

  const parts = [];
  if (information.length) parts.push(`Job Information\n${information.join('\n')}`);
  if (description) parts.push(`Job Description\n${description}`);
  return parts.join('\n\n');
}

function setNativeValue(field, value, blur = true) {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  field.focus?.({ preventScroll: true });
  if (setter) setter.call(field, value);
  else field.value = value;
  const InputEventConstructor = typeof InputEvent === 'function' ? InputEvent : Event;
  field.dispatchEvent(new InputEventConstructor('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: String(value),
  }));
  field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
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
  if (!(field instanceof HTMLInputElement)) field.click();
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
    const selected = control?.querySelector('.ant-select-selection-item, .select__single-value, .Select-value-label, [class*="singleValue"], .vdl-dropdown-list__input');
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
  if (!(field instanceof HTMLInputElement)) {
    dispatchKey(field, 'Escape', 'Escape', 27);
    field.blur();
    return false;
  }
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

function isICimsDropdown(field) {
  return /(?:^|\.)icims\.com$/i.test(location.hostname)
    && field.matches('a.dropdown-select[role="combobox"][id$="_icimsDropdown"]');
}

function isRipplingDropdown(field) {
  return /(?:^|\.)ats\.rippling\.com$/i.test(location.hostname)
    && field.getAttribute('role') === 'combobox'
    && Boolean(field.closest('[data-testid="select-controller"]'))
    && !field.closest('[data-testid="phone_number-code"]');
}

function ripplingSelectedValues(field) {
  const controller = field.closest('[data-testid="select-controller"]');
  return [
    field instanceof HTMLInputElement ? field.value : '',
    field.textContent,
    ...Array.from(controller?.querySelectorAll('p, [data-testid*="selected"]') || [])
      .map((element) => element.textContent),
  ].map(normalize).filter((value) => value && !/^select$/.test(value));
}

async function fillRipplingDropdown(field, answer) {
  const expected = normalize(answer);
  if (!expected) return false;
  if (ripplingSelectedValues(field).includes(expected)) return true;

  field.focus();
  field.click();
  dispatchKey(field, 'ArrowDown', 'ArrowDown', 40);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    await sleep(100);
    const options = Array.from(document.querySelectorAll('[role="option"]')).filter(isVisible);
    const labels = options.map((option) => cleanLabel(
      option.getAttribute('aria-label') || option.getAttribute('title') || option.textContent,
    ));
    const optionText = bestOption(labels, answer);
    const option = options.find((_item, index) => labels[index] === optionText);
    if (!(option instanceof HTMLElement)) continue;

    clickComboboxOption(option);
    await sleep(300);
    field.blur();
    return true;
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
}

function iCimsDropdownContainer(field) {
  const container = document.getElementById(`${field.id}_ctnr`);
  return container instanceof HTMLElement ? container : null;
}

function iCimsSelectedValue(field) {
  return cleanLabel(field.querySelector('.dropdown-text')?.textContent);
}

async function fillICimsDropdown(field, answer) {
  const expected = normalize(answer);
  if (!expected) return false;
  const selectedMatches = () => normalize(iCimsSelectedValue(field)) === expected;
  if (selectedMatches()) return true;

  field.focus();
  field.click();
  await sleep(150);

  const matchingOption = () => {
    const options = Array.from(iCimsDropdownContainer(field)
      ?.querySelectorAll('[role="option"].result-selectable') || []);
    const labels = options.map((option) => cleanLabel(
      option.getAttribute('aria-label') || option.getAttribute('title') || option.textContent,
    ));
    const optionText = bestOption(labels, answer);
    return options.find((option, index) => labels[index] === optionText) || null;
  };

  let searchStarted = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const option = matchingOption();
    if (option instanceof HTMLElement) {
      clickComboboxOption(option);
      await sleep(300);
      if (selectedMatches()) {
        field.blur();
        return true;
      }
    }

    const search = iCimsDropdownContainer(field)?.querySelector('input.dropdown-search:not([aria-hidden="true"])');
    if (!searchStarted && attempt >= 2 && search instanceof HTMLInputElement) {
      searchStarted = true;
      await typeComboboxSearch(search, answer);
    }
    await sleep(100);
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
}

function isWorkdayPage() {
  return /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/i.test(location.hostname);
}

function isGemDropdownButton(field) {
  return /(?:^|\.)jobs\.gem\.com$/i.test(location.hostname)
    && field instanceof HTMLButtonElement
    && field.matches('button[class*="inputGroupEligible"]');
}

async function fillGemDropdownButton(field, answer) {
  field.focus();
  field.click();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    const options = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .filter((option) => isVisible(option) && option.getAttribute('aria-disabled') !== 'true');
    const optionText = bestOption(options.map((option) => cleanText(option.textContent)), answer);
    const option = options.find((item) => cleanText(item.textContent) === optionText);
    if (!(option instanceof HTMLElement) || !optionText) continue;

    clickComboboxOption(option);
    await sleep(250);
    if (normalize(field.textContent) === normalize(optionText)) return true;
  }

  dispatchKey(field, 'Escape', 'Escape', 27);
  field.blur();
  return false;
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
    || usableOptions.find((option) => {
      const normalizedOption = normalize(option);
      return ` ${normalizedAnswer} `.includes(` ${normalizedOption} `)
        || ` ${normalizedOption} `.includes(` ${normalizedAnswer} `);
    });
}

async function fillField(record, answer) {
  const { field } = record;
  if (isRipplingDropdown(field)) {
    return fillRipplingDropdown(field, answer);
  }
  if (isICimsDropdown(field)) {
    return fillICimsDropdown(field, answer);
  }
  if (field.getAttribute('role') === 'combobox' && field.matches?.('.iti__selected-flag')) {
    return fillInternationalPhoneCountry(field, answer);
  }
  if (field.getAttribute('role') === 'combobox') {
    return fillCombobox(field, answer);
  }
  if (isGemDropdownButton(field)) {
    return fillGemDropdownButton(field, answer);
  }
  if (field.matches('button[aria-haspopup="listbox"]')) {
    return isWorkdayPage() ? fillWorkdayListboxButton(field, answer) : false;
  }
  if (field instanceof HTMLSelectElement) {
    const enabledOptions = Array.from(field.options).filter((option) => option.value && !option.disabled);
    const optionText = bestOption(enabledOptions.map((option) => option.textContent || ''), answer);
    const option = enabledOptions.find((item) => item.textContent === optionText);
    if (!option) return false;
    setNativeValue(field, option.value);
    return true;
  }
  if (field.getAttribute('role') === 'radio') {
    const group = field.closest('[role="radiogroup"]');
    const candidates = Array.from(group?.querySelectorAll('[role="radio"]') || [field]);
    const optionText = bestOption(candidates.map(optionLabel), answer);
    const candidate = candidates.find((item) => optionLabel(item) === optionText);
    if (!(candidate instanceof HTMLElement)) return false;
    candidate.click();
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
    await sleep(75);
    const actual = normalize(field.value);
    const expected = normalize(answer);
    return Boolean(actual && expected && (actual === expected || actual.includes(expected) || expected.includes(actual)));
  }
  return false;
}

async function fillTextEntryField(record, answer) {
  const { field } = record;
  if (!isTextEntryField(field)) return false;
  setNativeValue(field, answer);
  await sleep(75);
  const actual = normalize(field.value);
  const expected = normalize(answer);
  return Boolean(actual && expected && (actual === expected || actual.includes(expected) || expected.includes(actual)));
}

function splitFullName(fullName) {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts.length > 1 ? parts.at(-1) || '' : '',
  };
}

function phoneValueForField(phone, country, field) {
  const value = cleanText(phone);
  if (!value) return value;
  const digits = value.replace(/\D/g, '');
  const ripplingPhoneGroup = /(?:^|\.)ats\.rippling\.com$/i.test(location.hostname)
    ? field?.closest('[data-testid="field"]')
    : null;
  const ripplingDialCodeField = ripplingPhoneGroup
    ?.querySelector('[data-testid="phone_number-code"] input[role="combobox"]');
  const ripplingDialCode = cleanText(ripplingDialCodeField?.value).match(/^\+(\d+)/)?.[1] || '';
  if (ripplingDialCode) {
    if (value.trim().startsWith(`+${ripplingDialCode}`)) {
      return value.trim().slice(ripplingDialCode.length + 1).replace(/^[\s.-]+/, '').trim();
    }
    if (digits.startsWith(ripplingDialCode) && digits.length > 10) {
      return digits.slice(ripplingDialCode.length);
    }
    return value;
  }
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
  const asksAbilityToWork = /authorized to work|legally authorized|right to work|able to work|eligible to work|work in the (?:us|united states)/.test(identity);
  if (!asksWithoutSponsorship || !asksAbilityToWork) return '';

  const sponsorship = normalize(profile?.requiresSponsorship);
  const authorization = normalize(profile?.legallyAuthorizedUs);
  if (!['yes', 'no'].includes(sponsorship) || !['yes', 'no'].includes(authorization)) return '';

  const asksUsLocation = /\blocated\b/.test(identity);
  const country = normalize(profile?.country);
  const locatedInUs = !asksUsLocation || /^(?:united states(?: of america)?|usa|us)$/.test(country);
  return sponsorship === 'no' && authorization === 'yes' && locatedInUs ? 'Yes' : 'No';
}

function usWorkStatusValue(field, identity, profile) {
  const status = normalize(profile?.usWorkStatus);
  if (!['us citizen', 'green card', 'other'].includes(status)) return '';

  const asksCitizen = /\b(?:us|u s|united states) citizen(?:ship)?\b|\bcitizenship\b/.test(identity);
  const asksGreenCard = /\bgreen card\b|\bpermanent resident\b/.test(identity);
  if (!asksCitizen && !asksGreenCard) return '';

  const options = fieldOptions(field);
  const optionMatching = (predicate) => options.find((option) => predicate(normalize(option)));
  const hasCompoundOptions = options.some((option) => /\bcitizen\b/.test(normalize(option)))
    && options.some((option) => /\bgreen card\b|\bpermanent resident\b/.test(normalize(option)));

  if (hasCompoundOptions) {
    if (status === 'us citizen') {
      return optionMatching((option) => /\bcitizen\b/.test(option)) || 'I am a US Citizen';
    }
    if (status === 'green card') {
      return optionMatching((option) => (
        /\bgreen card\b|\bpermanent resident\b/.test(option)
        && !/^(?:no|not)\b|\bdo not\b/.test(option)
      )) || 'Yes, I have a Green Card';
    }
    return optionMatching((option) => (
      /\bgreen card\b|\bpermanent resident\b/.test(option)
      && (/^(?:no|not)\b/.test(option) || /\bdo not\b/.test(option))
    )) || 'No, I do not have a Green Card';
  }

  if (asksCitizen && asksGreenCard) return ['us citizen', 'green card'].includes(status) ? 'Yes' : 'No';
  if (asksCitizen) return status === 'us citizen' ? 'Yes' : 'No';
  return status === 'green card' ? 'Yes' : 'No';
}

function profileValueForField(field, profile) {
  const label = normalize(fieldLabel(field));
  const identifier = normalize([
    field.id,
    field.getAttribute('name'),
    field.getAttribute('autocomplete'),
  ].filter(Boolean).join(' '));
  const identity = normalize([identifier, label].filter(Boolean).join(' '));
  const names = splitFullName(profile?.fullName);
  const firstName = cleanText(profile?.firstName) || names.firstName;
  const middleName = cleanText(profile?.middleName) || names.middleName;
  const lastName = cleanText(profile?.lastName) || names.lastName;
  const fullName = cleanText(profile?.fullName) || [firstName, middleName, lastName].filter(Boolean).join(' ');
  const workableLocation = workableLocationValue(identity, profile);
  const combinedWorkAuthorization = combinedWorkAuthorizationValue(identity, profile);
  const usWorkStatus = usWorkStatusValue(field, identity, profile);

  if (/\b(first|given) name\b|\bgiven name\b|\bgiven name$/.test(identity) || field.autocomplete === 'given-name') return firstName;
  if (/\bmiddle (?:name|initial)\b|\bmiddleinitial\b/.test(identity) || field.autocomplete === 'additional-name') {
    return /\bmiddle initial\b|\bmiddleinitial\b/.test(identity) ? middleName.charAt(0) : middleName;
  }
  if (/\b(last|family|surname) name\b|\bfamily name\b|\bsurname\b/.test(identity) || field.autocomplete === 'family-name') return lastName;
  if (/\bfull name\b|\blegal name\b|\bsystemfield name\b/.test(identity) || label === 'name' || field.autocomplete === 'name') return fullName;
  if (/\be ?mail\b/.test(identity) || field.autocomplete === 'email') return profile?.email;
  if (/\bphone (?:device )?type\b|\bphonetype\b/.test(identity)) return 'Mobile';
  if (/\bphone extension\b|\bextension\b/.test(identity)) return '';
  if (/phone.*country|telephone country code/.test(identity)) return canonicalCountry(profile?.country);
  if (/\b(phone|mobile|tel)\b/.test(identity) || field.autocomplete === 'tel') return phoneValueForField(profile?.phone, profile?.country, field);
  if (/\blinkedin\b/.test(identity)) return profile?.linkedin;
  if (usWorkStatus) return usWorkStatus;
  if (combinedWorkAuthorization) return combinedWorkAuthorization;
  // Authorization and sponsorship questions can mention the country where the
  // job is located. Resolve their intent before the generic country field.
  if (/legally authorized|authorized to work|right to work|work authorization/.test(identity)) return profile?.legallyAuthorizedUs;
  if (/sponsorship/.test(identity)) return profile?.requiresSponsorship;
  // Compound ATS identifiers often contain an address index before the actual
  // component, such as `work-history-address-1-zip`. Match components first.
  if (/\baddress ?type\b/.test(identity)) return 'Home';
  if (/\b(zip|postal code|postcode)\b/.test(identity)) return profile?.zip;
  if (/\b(city|town)\b/.test(identity)) return profile?.city;
  if (/\bcounty\b/.test(identity)) return profile?.county;
  if (/\b(state|province|region)\b/.test(identity)) return canonicalUsState(profile?.state);
  if (/\baddress\s*(?:line\s*)?(?:1|one)\b|\baddressline1\b|\bstreet address\b/.test(identity)) return profile?.address1;
  if (workableLocation) return workableLocation;
  if (/\b(country|country code)\b/.test(identity) || field.autocomplete === 'country') return canonicalCountry(profile?.country);
  if (/candidate location|location city|\blocation\b/.test(identity)) return profile?.location;
  // Prefer explicit identifiers before labels. Greenhouse calls its Yes/No field
  // `hispanic_ethnicity`, while some other ATS labels include all race option text.
  if (/\brace\b/.test(identifier)) return profile?.ethnicity;
  if (/hispanic|latino/.test(identifier)) return profile?.hispanicLatino;
  if (/\brace\b/.test(label)) return profile?.ethnicity;
  if (/hispanic|latino/.test(label)) return profile?.hispanicLatino;
  if (/\bethnicity\b/.test(identity)) return profile?.ethnicity;
  if (/\b(gender|sex)\b/.test(identity)) return profile?.gender;
  if (/\b(disability|disabled)\b/.test(identity)) {
    return 'No, I do not have a disability and have not had one in the past';
  }
  if (/\bveteran\b/.test(identity)) {
    const negativeOption = fieldOptions(field).find((option) => {
      const normalizedOption = normalize(option);
      return /\bnot\b.*\bveteran\b/.test(normalizedOption)
        && !/decline|prefer not|do not wish/.test(normalizedOption);
    });
    return negativeOption || (isWorkdayPage() ? 'I am not a veteran' : 'I am not a protected veteran');
  }
  if (
    /consent.*receive.*text messages?.*application status/.test(identity)
    || (/text messages?.*(?:job )?application/.test(identity) && /agree|agreement|consent|updates/.test(identity))
  ) return 'Yes';
  if (/subscribe|contact preference|text message|job alert|new opportunities/.test(identity)) return 'No';
  return '';
}

function adpProfileField(id) {
  const field = document.getElementById(id);
  return field instanceof HTMLInputElement ? field : null;
}

function adpFullAddress(profile) {
  const address = cleanText(profile?.address1);
  if (!address) return '';
  const normalizedAddress = normalize(address);
  const parts = [address];
  for (const value of [profile?.city, profile?.state, profile?.zip]) {
    const cleaned = cleanText(value);
    if (cleaned && !normalizedAddress.includes(normalize(cleaned))) parts.push(cleaned);
  }
  return parts.join(', ');
}

async function fillAdpControlledInput(field, value, blur = true) {
  if (!(field instanceof HTMLInputElement) || !cleanText(value)) return false;
  field.focus();
  field.select?.();
  try {
    const inserted = typeof document.execCommand === 'function'
      && document.execCommand('insertText', false, String(value));
    if (inserted) {
      field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      if (blur) field.blur();
      await sleep(150);
      if (normalize(field.value) === normalize(value)) return true;
    }
  } catch {
    // Fall through to the explicit keyboard/input event sequence.
  }
  await typeComboboxSearch(field, value);
  if (blur) field.blur();
  await sleep(150);
  return normalize(field.value) === normalize(value);
}

function adpAddressSuggestions(address) {
  const selectors = [
    '.pac-container .pac-item',
    '[class*="address"][class*="suggest"]',
    '[class*="location"][class*="suggest"]',
    '[role="listbox"] [role="option"]',
  ];
  const candidates = [...new Set(Array.from(document.querySelectorAll(selectors.join(', '))))]
    .filter(isVisible);
  const addressWords = normalize(address).split(' ').filter((word) => word.length > 2 || /^\d+$/.test(word));
  const streetNumber = addressWords.find((word) => /^\d+$/.test(word));
  const scored = candidates.map((candidate, index) => {
    const text = normalize(candidate.textContent);
    const matchingWords = addressWords.filter((word) => text.includes(word)).length;
    const numberMatches = !streetNumber || text.includes(streetNumber);
    const isGooglePlacesSuggestion = Boolean(candidate.matches?.('.pac-item'));
    return { candidate, index, score: matchingWords + (numberMatches ? 5 : 0) + (isGooglePlacesSuggestion ? 2 : 0) };
  }).filter(({ candidate, score }) => candidate instanceof HTMLElement && score > 2);
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.map(({ candidate }) => candidate);
}

async function fillAdpAddress(profile) {
  const addressField = adpProfileField('PersonalAddress_address_line1');
  const fullAddress = adpFullAddress(profile);
  if (!addressField || !fullAddress) return false;

  const addressWasPopulated = () => {
    const city = cleanText(adpProfileField('PersonalAddress_city')?.value);
    const zip = cleanText(adpProfileField('PersonalAddress_postalCode')?.value);
    const stateControl = document.getElementById('PersonalAddress_state');
    const state = cleanText(stateControl?.querySelector('.vdl-dropdown-list__input')?.textContent
      || stateControl?.textContent);
    return Boolean(city && zip && state);
  };
  const waitForPopulatedAddress = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(100);
      if (addressWasPopulated()) return true;
    }
    return false;
  };

  await fillAdpControlledInput(addressField, fullAddress, false);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suggestion = adpAddressSuggestions(fullAddress)[0];
    if (suggestion instanceof HTMLElement) {
      clickComboboxOption(suggestion);
      if (await waitForPopulatedAddress()) return true;
      // The suggestion was selected even if ADP has not finished exposing every
      // derived field. Do not replace the validated address with raw text values.
      return true;
    }
    await sleep(100);
  }
  // ADP can render its location menu in a portal that is not queryable from the
  // extension's isolated world. The focused input still accepts keyboard choice.
  addressField.focus();
  dispatchKey(addressField, 'ArrowDown', 'ArrowDown', 40);
  await sleep(200);
  dispatchKey(addressField, 'Enter', 'Enter', 13);
  if (await waitForPopulatedAddress()) return true;
  addressField.blur();
  return false;
}

async function fillAdpProfileFields(profile) {
  const handled = new Set();
  const filledQuestions = [];
  const nameFields = [
    ['personalInfomationFirstName', cleanText(profile?.firstName) || splitFullName(profile?.fullName).firstName],
    ['personalInfomationMiddleName', cleanText(profile?.middleName) || splitFullName(profile?.fullName).middleName],
    ['personalInfomationLastName', cleanText(profile?.lastName) || splitFullName(profile?.fullName).lastName],
  ];
  for (const [id, value] of nameFields) {
    const field = adpProfileField(id);
    if (!field || !value) continue;
    if (await fillAdpControlledInput(field, value)) {
      handled.add(field);
      filledQuestions.push(fieldLabel(field) || id);
    }
  }

  if (await fillAdpAddress(profile)) {
    for (const id of [
      'PersonalAddress_address_line1',
      'PersonalAddress_city',
      'PersonalAddress_state',
      'PersonalAddress_postalCode',
      'PersonalAddress_county',
    ]) {
      const field = document.getElementById(id);
      if (field) handled.add(field);
    }
    filledQuestions.push('Validated address');
  }
  return { handled, filledQuestions };
}

async function fillProfileFields(profile, inputBoxesOnly = false) {
  const adpResult = inputBoxesOnly
    ? { handled: new Set(), filledQuestions: [] }
    : await fillAdpProfileFields(profile);
  let filled = adpResult.handled.size;
  const filledQuestions = [...adpResult.filledQuestions];
  const skippedQuestions = [];
  const seen = new Set(adpResult.handled);
  // Greenhouse reveals dependent fields after earlier answers (for example, Race after
  // Hispanic/Latino = No). Rescan between passes so those newly mounted controls are included.
  for (let pass = 0; pass < 4; pass += 1) {
    for (const field of document.querySelectorAll(FIELD_SELECTOR)) {
      if (!isVisible(field) || field.disabled || field.readOnly || seen.has(field)) continue;
      if (inputBoxesOnly && !isTextEntryField(field)) {
        seen.add(field);
        continue;
      }
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
          seen.add(field);
          filled += 1;
          filledQuestions.push(question);
        }
        else seen.add(field);
        continue;
      }
      const record = { field, question, normalized: normalize(question), sensitive: SENSITIVE_FIELD.test(question) };
      if (await (inputBoxesOnly ? fillTextEntryField(record, value) : fillField(record, value))) {
        seen.add(field);
        filled += 1;
        filledQuestions.push(question);
      }
      else if (pass === 3) skippedQuestions.push(question);
      await sleep(100);
    }
    if (pass < 3) await sleep(250);
  }
  return { filled, filledQuestions, skippedQuestions };
}

async function fillCoverLetterField(coverLetterText, inputBoxesOnly = false) {
  const value = String(coverLetterText || '').trim();
  if (!value) return { filled: 0, filledQuestions: [], skippedQuestions: [] };
  for (const field of document.querySelectorAll(FIELD_SELECTOR)) {
    if (!isVisible(field) || field.disabled || field.readOnly) continue;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) continue;
    const question = fieldLabel(field) || field.id || field.getAttribute('name') || '';
    if (!/\bcover letter\b/i.test(cleanLabel(question).replace(/[_-]+/g, ' '))) continue;
    const record = { field, question, normalized: normalize(question), sensitive: false };
    return await (inputBoxesOnly ? fillTextEntryField(record, value) : fillField(record, value))
      ? { filled: 1, filledQuestions: [question], skippedQuestions: [] }
      : { filled: 0, filledQuestions: [], skippedQuestions: [question] };
  }
  return { filled: 0, filledQuestions: [], skippedQuestions: [] };
}

async function fillAnswers(answers, profile, coverLetterText, inputBoxesOnly = false) {
  const records = extractFields();
  const eligibleRecords = inputBoxesOnly
    ? records.filter((record) => isTextEntryField(record.field))
    : records;
  const profileResult = await fillProfileFields(profile || {}, inputBoxesOnly);
  const coverLetterResult = await fillCoverLetterField(coverLetterText, inputBoxesOnly);
  let filled = profileResult.filled + coverLetterResult.filled;
  const filledQuestions = [...profileResult.filledQuestions, ...coverLetterResult.filledQuestions];
  const skippedQuestions = [...profileResult.skippedQuestions, ...coverLetterResult.skippedQuestions];
  for (const item of Array.isArray(answers) ? answers : []) {
    const question = cleanLabel(item?.question);
    const answer = cleanText(item?.answer);
    if (!question || !answer) continue;
    const target = eligibleRecords.find((record) => record.normalized === normalize(question))
      || eligibleRecords.find((record) => record.normalized.includes(normalize(question)) || normalize(question).includes(record.normalized));
    const wasFilled = target && !target.sensitive && await (
      inputBoxesOnly ? fillTextEntryField(target, answer) : fillField(target, answer)
    );
    if (!wasFilled) {
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
    extractPage(message.includeQuestions !== false).then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : 'Page extraction failed' });
    });
    return true;
  }
  if (message?.type === RESUME_AI_FILL_ANSWERS) {
    fillAnswers(message.answers, message.profile, message.coverLetterText, message.inputBoxesOnly === true).then(sendResponse).catch((error) => {
      sendResponse({ filled: 0, skipped: 1, filledQuestions: [], skippedQuestions: [error instanceof Error ? error.message : 'Autofill failed'] });
    });
    return true;
  }
});
// Notify the service worker only after the final application submission action. The worker ignores
// this signal unless resume generation armed this exact tab with an application id.
(() => {
  if (typeof document?.addEventListener !== "function") return;
  let lastSignalAt = 0;
  const signalSubmission = () => {
    const now = Date.now();
    if (now - lastSignalAt < 3000) return;
    lastSignalAt = now;
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "APPLICATION_FORM_SUBMITTED" }).catch(() => undefined);
    }, 1200);
  };

  const isFinalSubmitLabel = (target) => {
    const label = (target?.textContent || target?.getAttribute?.("value") || target?.getAttribute?.("aria-label") || "")
      .trim().toLowerCase();
    return /^(submit|submit (?:my |your |this |the )?application|send application|complete application|finish application|apply now)$/.test(label);
  };

  const confirmationPatterns = [
    /\bapplication (?:has been|was|is) (?:successfully )?submitted\b/,
    /\b(?:you(?:'ve| have) )?successfully submitted your application\b/,
    /\bthank you for (?:submitting your application|applying)\b/,
    /\bthanks for (?:submitting your application|applying)\b/,
    /\bwe(?:'ve| have) received your application\b/,
    /\byour application (?:has been received|is complete)\b/,
  ];

  const hasSubmissionConfirmation = () => {
    const text = (document.body?.innerText || document.body?.textContent || "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (confirmationPatterns.some((pattern) => pattern.test(text))) return true;
    const path = globalThis.location?.pathname || "";
    return /\/(?:application[-_/]?)?(?:submitted|confirmation|thank[-_]?you)(?:[/?#]|$)/i.test(path);
  };

  let confirmationScanQueued = false;
  const scanForConfirmation = () => {
    if (confirmationScanQueued) return;
    confirmationScanQueued = true;
    setTimeout(() => {
      confirmationScanQueued = false;
      if (hasSubmissionConfirmation()) signalSubmission();
    }, 250);
  };

  document.addEventListener("submit", (event) => {
    if (isFinalSubmitLabel(event.submitter)) signalSubmission();
  }, true);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, input[type="submit"], [role="button"]')
      : null;
    if (!target) return;
    if (isFinalSubmitLabel(target)) signalSubmission();
  }, true);

  scanForConfirmation();
  if (typeof MutationObserver === "function" && document.documentElement) {
    new MutationObserver(scanForConfirmation).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
