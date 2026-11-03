const RESUME_AI_EXTRACT_PAGE = "RESUME_AI_EXTRACT_PAGE";

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

// TextContent joins adjacent HTML blocks together, especially in detached JSON-LD descriptions.
// Read block boundaries and list items explicitly so the saved JD keeps its original structure.
function descriptionText(element) {
  const read = (node, listDepth = 0) => {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'button', 'input', 'select'].includes(tag)
      || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
    if (tag === 'br') return '\n';
    if (tag === 'ul' || tag === 'ol') {
      return '\n' + Array.from(node.childNodes).map((child) => read(child, listDepth + 1)).join('') + '\n';
    }
    const text = Array.from(node.childNodes).map((child) => read(child, listDepth)).join('');
    if (tag === 'li') {
      const siblings = Array.from(node.parentElement?.children || []).filter((child) => child.tagName === 'LI');
      const marker = node.parentElement?.tagName === 'OL' ? `${siblings.indexOf(node) + 1}.` : '-';
      return `${'  '.repeat(Math.max(0, listDepth - 1))}${marker} ${text.trim()}\n`;
    }
    if (/^h[1-6]$/.test(tag) || ['p', 'section', 'article'].includes(tag)) return `\n\n${text.trim()}\n\n`;
    if (['div', 'main', 'header', 'blockquote', 'tr', 'dl', 'dt', 'dd'].includes(tag)) return `\n${text.trim()}\n`;
    return text;
  };
  return read(element).replace(/\u00a0/g, ' ').split('\n').map((line) => {
    const indent = line.match(/^ +(?=(?:-|\d+[.)]) )/)?.[0] || '';
    return indent + line.trim().replace(/[ \t]+/g, ' ');
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  const description = descriptionText(parsed.body);
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
    const contentText = descriptionText(content);
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
      const text = descriptionText(element);
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
      const text = descriptionText(element);
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === RESUME_AI_EXTRACT_PAGE) {
    extractPage(message.includeQuestions !== false).then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : 'Page extraction failed' });
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
    if (isFinalSubmitLabel(event.submitter)) scanForConfirmation();
  }, true);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, input[type="submit"], [role="button"]')
      : null;
    if (!target) return;
    if (isFinalSubmitLabel(target)) scanForConfirmation();
  }, true);

  scanForConfirmation();
  if (typeof MutationObserver === "function" && document.documentElement) {
    new MutationObserver(scanForConfirmation).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
