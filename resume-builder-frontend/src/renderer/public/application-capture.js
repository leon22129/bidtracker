// Observes only the application explicitly armed by the side panel. This script
// runs in each frame and never changes a form value or advances the application.
(() => {
  // A startup retry replaces the old observer instead of stacking listeners.
  try { globalThis.__resumeAiFormCapture?.stop(); } catch { /* The previous extension context may have been invalidated. */ }
  const cleanups = [];
  let stopped = false;
  const choiceSelector = '[role="combobox"], [aria-haspopup="listbox"], button[class*="inputGroupEligible"]';
  const yesNoSelector = '.ashby-application-form-input-yesno';
  const groupSelector = '[role="radiogroup"], [role="group"], fieldset, [data-automation-id^="formField"]';
  const selector = [
    'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'textarea', 'select', choiceSelector, yesNoSelector, '[role="radio"]', '[role="checkbox"]',
    '[role="switch"]', '[contenteditable="true"]',
  ].join(',');
  let token = null;
  let queued;
  let lastSignature = '';
  let lastTimestamp = 0;
  let pending = Promise.resolve();
  let checking = false;

  const cleanCaption = (text) => cleanLabel(text).replace(/^[\s*\u2731\u2733]+|[\s*\u2731\u2733]+$/g, '')
    .replace(/\s*\((?:required|optional)\)\s*$/i, '').trim();
  const labelText = (element) => cleanCaption(element?.innerText || element?.textContent || '');
  const visible = (element) => isVisible(element) && !element.closest('[hidden], [aria-hidden="true"], [inert]');
  const placeholderChoice = (text) => /^(?:[-\s]*|(?:(?:please )?select|choose)(?:\s+(?:one|an?|the|your)\b.*?)?(?:\s*(?:[.\u2026*-]|\(?(?:required|optional)\)?))*)$/i.test(text.trim());
  const choiceText = (text) => placeholderChoice(text) ? '' : text.trim();

  function choiceRoot(field) {
    const root = field.closest(
      '[data-automation-id="selectWidget"], [data-automation-id="multiselectInputContainer"], [data-testid="select-controller"], .pcty-input-select-full-container, [class*="-control"], [class*="__control"]',
    );
    // A generic class can also describe a container holding unrelated fields.
    if (!root || [...root.querySelectorAll(`${choiceSelector}, input:not([type="hidden"]), select, textarea`)]
      .some((other) => !field.contains(other) && !other.contains(field))) return field;
    return root;
  }

  function captionText(element) {
    if (!element) return '';
    const caption = element.cloneNode(true);
    caption.querySelectorAll(`input, select, textarea, button, ${choiceSelector}, ${yesNoSelector}, [role="listbox"], [role="option"], [role="radiogroup"], [role="group"], [role="button"], [data-role="dropzone"], [data-testid="select-controller"], [hidden], [aria-hidden="true"], label`)
      .forEach((child) => child.remove());
    return labelText(caption);
  }

  // Read the visible value without hidden options, search inputs or status text.
  function displayedChoice(element) {
    const read = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof Element) || !visible(node)
        || node.matches('input, select, textarea, label, [role="listbox"], [role="option"], [role="alert"], [role="status"], button[aria-label^="Remove" i], button[aria-label^="Clear" i]')) return '';
      return [...node.childNodes].map(read).join(' ');
    };
    return cleanText(read(element));
  }

  function selectedAnswer(field) {
    const root = choiceRoot(field);
    const inputs = [...root.querySelectorAll('input:not([type="hidden"])')];
    const controls = [field, ...inputs];
    for (const control of controls) {
      const text = choiceText(control.getAttribute('aria-valuetext') || '');
      if (text) return text;
    }
    // Searchable widgets (including React Select) render the committed choice
    // beside an empty input. Restrict the lookup to this widget, not its form.
    const selected = [...root.querySelectorAll(
      '[data-automation-id="selectedItem"], [data-automation-id="promptOption"], .input-select-input-single-value, .rw-input, [class*="-singleValue"], [class*="__single-value"], [class*="-multiValue"], [class*="__multi-value"]',
    )].filter((item) => visible(item) && !item.closest('[role="listbox"], [role="option"]'));
    const values = selected.filter((item) => !selected.some((other) => other !== item && other.contains(item)))
      .map(displayedChoice).map(choiceText).filter(Boolean);
    if (values.length) return values.join('\n');

    // Only the listbox owned by this field can supply its selection. The active
    // descendant is keyboard focus and does not necessarily mean selected.
    const ownedIds = controls.flatMap((control) =>
      `${control.getAttribute('aria-controls') || ''} ${control.getAttribute('aria-owns') || ''}`.trim().split(/\s+/));
    const options = [...new Set(ownedIds.filter(Boolean).flatMap((id) =>
      [...(document.getElementById(id)?.querySelectorAll('[role="option"][aria-selected="true"]') || [])]))];
    if (options.length) return options.map((option) => choiceText((option.textContent || '').trim())).filter(Boolean).join('\n');

    const displayed = choiceText(displayedChoice(root));
    if (displayed) return displayed;
    const input = field instanceof HTMLInputElement ? field : inputs.find(visible);
    return choiceText(String(input?.value ?? ''));
  }
  const firstText = (selectors) => {
    for (const query of selectors) {
      const element = [...document.querySelectorAll(query)].find(visible);
      const text = labelText(element);
      if (text) return text.slice(0, 300);
    }
    return '';
  };

  function questionFor(field) {
    if (field.closest('[data-testid="phone_number-code"]')) return 'Phone country code';
    const dedicated = field.closest('.application-question')?.querySelector('.application-label')
      || field.closest('.ashby-application-form-field-entry, .ashby-application-form-input-radio-group, .ashby-application-form-input-checkbox-group')?.querySelector('.ashby-application-form-question-title')
      || field.closest('[data-automation-id^="formField"]')?.querySelector('[data-automation-id="formLabel"], label')
      || field.closest('[data-testid="field"]')?.querySelector('[id$="-label"]')
      || (field.closest('[data-testid="select-controller"]') && field.closest('.marginY--36')?.querySelector('.paddingX--16 p'));
    if (captionText(dedicated)) return captionText(dedicated);
    const label = field.labels?.[0] || field.closest('label');
    const isFile = field instanceof HTMLInputElement && field.type === 'file';
    if (!isFile && captionText(label)) return captionText(label);
    const labelledBy = field.getAttribute('aria-labelledby') || (isFile && label?.getAttribute('aria-labelledby'));
    if (labelledBy) {
      const root = choiceRoot(field);
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id))
        .filter((element) => element && !root.contains(element)
          && !element.matches('[role="button"], [role="status"], [data-testid="screen-reader-only"]'))
        .map(captionText).filter((text) => text && !placeholderChoice(text) && !/^(?:required|optional)$/i.test(text)).join(' ');
      if (text) return cleanLabel(text);
    }
    if (captionText(label) && !label.matches('[role="button"]')) return captionText(label);
    return fieldLabel(field);
  }

  function sectionFor(field) {
    const parts = [];
    for (let parent = field.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const caption = parent.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > [role="heading"]');
      const text = labelText(caption);
      if (text && !parts.includes(text)) parts.unshift(text);
      if (parts.length === 3) break;
    }
    return parts.join(' / ').slice(0, 300);
  }

  function groupCaption(field, group) {
    const ids = group?.getAttribute('aria-labelledby');
    const caption = ids ? cleanLabel(textFromIds(ids)) : '';
    const legend = labelText(group?.querySelector(':scope > legend, :scope > .ashby-application-form-question-title'));
    const automation = field.closest('[data-automation-id^="formField"]');
    const automationLabel = labelText(automation?.querySelector('[data-automation-id="formLabel"], label'));
    const outerLabel = captionText(group?.closest('label'));
    return caption || group?.getAttribute('aria-label') || legend || automationLabel || outerLabel || questionFor(field);
  }

  function capturedOptionLabel(field) {
    const label = field.closest('label') || field.labels?.[0];
    const dedicated = label?.querySelector('.application-answer-alternative, .eeo-option-text');
    if (labelText(dedicated)) return labelText(dedicated);
    if (label) {
      const caption = label.cloneNode(true);
      caption.querySelectorAll('input, [hidden], [aria-hidden="true"], .eeo-option-description').forEach((child) => child.remove());
      if (labelText(caption)) return labelText(caption);
    }
    return optionLabel(field);
  }

  function selectProxy(select) {
    // Enhanced dropdowns hide the original select but still store the actual
    // selected options there. Only accept a visible, associated replacement.
    const proxySelector = '.select2-container, .chosen-container, .k-dropdown, .k-dropdownlist, .k-multiselect';
    const candidates = [select.closest(proxySelector), select.nextElementSibling,
      select.id && document.getElementById(`s2id_${select.id}`), select.id && document.getElementById(`${select.id}_chosen`)];
    return candidates.find((element) => element && element.matches(proxySelector) && visible(element));
  }

  function readSnapshot() {
    // Login screens are not application steps, even when they share the same tab.
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return null;
    const proxies = new Map([...document.querySelectorAll('select')].map((select) => [select, selectProxy(select)])
      .filter(([, proxy]) => proxy));
    const elements = [...document.querySelectorAll(selector)].filter((field) => (visible(field) || proxies.has(field)
      || (field instanceof HTMLInputElement && ['radio', 'checkbox', 'file'].includes(field.type)
        && [...(field.labels || [])].some(visible)))
      && ![...proxies].some(([select, proxy]) => field !== select && proxy.contains(field))
      && !field.closest('nav, header, footer, [role="search"], [role="listbox"]')
      && !/^(?:password|current-password|new-password|one-time-code|username)$/i.test(field.autocomplete || '')
      && !/\b(?:password|verification code|security code|one.time code|captcha)\b/i.test(fieldLabel(field)));
    const fields = [];
    const consumed = new Set();
    const occurrences = new Map();
    for (const field of elements) {
      if (consumed.has(field)) continue;
      // A native select owns its value. For a custom combobox, the inner input
      // can be only a search box; read the whole widget and consume it once.
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)
        && (field.querySelector('select, textarea')
          || (!field.matches(`${choiceSelector}, ${yesNoSelector}`) && field.querySelector('input:not([type="hidden"])')))) continue;
      const role = field.getAttribute('role');
      const type = field.matches(yesNoSelector) ? 'radio' : role
        || (field.matches(choiceSelector) && !(field instanceof HTMLSelectElement) ? 'combobox'
          : field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase());
      let question = questionFor(field);
      let answer = '';
      if (field.matches(yesNoSelector)) {
        // The hidden checkbox cannot distinguish "No" from unanswered.
        answer = [...field.querySelectorAll('button[aria-pressed="true"]')].filter(visible).map(labelText).join('\n');
        elements.filter((other) => field.contains(other)).forEach((other) => consumed.add(other));
      } else if (['radio', 'checkbox', 'switch'].includes(type)) {
        const group = field.closest(groupSelector);
        const ashbyCheckboxes = type === 'checkbox' && group?.matches('.ashby-application-form-input-checkbox-group');
        const peers = elements.filter((other) => {
          if (other === field) return true;
          if ((other.getAttribute('role') || other.type) !== type) return false;
          if (ashbyCheckboxes) return group.contains(other);
          if (field instanceof HTMLInputElement && field.name) {
            return other.name === field.name && other.form === field.form
              && other.closest(groupSelector) === group;
          }
          return type === 'radio' && group && group.contains(other);
        });
        peers.forEach((peer) => consumed.add(peer));
        const checked = peers.filter((peer) => peer.checked || peer.getAttribute('aria-checked') === 'true');
        if (type === 'radio' || peers.length > 1 || ashbyCheckboxes) {
          question = groupCaption(field, group);
          answer = checked.map(capturedOptionLabel).join('\n');
        } else answer = checked.length ? 'Yes' : 'No';
      } else if (field instanceof HTMLSelectElement) {
        answer = [...field.selectedOptions].map((option) => choiceText(option.label)).filter(Boolean).join('\n');
      } else if (field instanceof HTMLInputElement && field.type === 'file') {
        answer = [...(field.files || [])].map((file) => file.name).join('\n');
      } else if (field.matches(choiceSelector)) {
        answer = selectedAnswer(field);
        elements.filter((other) => field.contains(other)).forEach((other) => consumed.add(other));
      } else if ('value' in field && field.tagName !== 'BUTTON') {
        answer = String(field.value ?? '');
        const dialCode = field.type === 'tel' && field.closest('.iti')?.querySelector('.iti__selected-dial-code');
        if (answer.trim() && !answer.trim().startsWith('+') && dialCode && visible(dialCode)) {
          answer = `${labelText(dialCode)} ${answer}`;
        }
      } else {
        answer = field.getAttribute('aria-valuetext') || (field.innerText || field.textContent || '').trim();
        if (placeholderChoice(answer)) answer = '';
      }
      question = cleanCaption(question);
      if (!question) continue;
      const section = sectionFor(field);
      // Occurrence keeps repeated employment/education fields distinct, including
      // sites that reuse names or generate new DOM ids on every visit.
      const identity = `${section}|${type}|${question}`;
      const occurrence = (occurrences.get(identity) || 0) + 1;
      occurrences.set(identity, occurrence);
      fields.push({ id: `${identity}|${occurrence}`.slice(0, 1000), question,
        answer, section, field_type: type });
    }
    if (!fields.length) return null;
    const step = firstText([
      '[aria-current="step"]', '[data-automation-id="progressBarActiveStep"]',
      '[data-automation-id="progressBar"] [aria-current="true"]',
      '[data-automation-id="pageHeader"]', 'main h2', '[role="main"] h2',
      'main h1', '[role="main"] h1', 'form h2', 'form h1', 'h1',
    ]) || fields[0].section || 'Application form';
    const url = location.origin + location.pathname;
    // Some portals keep the job title as the only heading throughout the wizard.
    // The first question distinguishes those pages without using their answers.
    return { key: `${url}|${step}|${fields[0].question}`.slice(0, 2000), step, url, fields };
  }

  function capture() {
    clearTimeout(queued);
    if (stopped || !token) return pending;
    const snapshot = readSnapshot();
    if (!snapshot) return pending;
    const signature = JSON.stringify(snapshot);
    if (signature === lastSignature) return pending;
    lastSignature = signature;
    const observedToken = token;
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    const step = { ...snapshot, captured_at: lastTimestamp };
    pending = pending.catch(() => undefined).then(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'APPLICATION_FORM_CAPTURE', token: observedToken, step });
        if (!response?.ok && lastSignature === signature) lastSignature = '';
      } catch { if (lastSignature === signature) lastSignature = ''; }
    });
    return pending;
  }

  const schedule = () => {
    clearTimeout(queued);
    if (token) queued = setTimeout(capture, 200);
  };
  async function refreshContext() {
    if (stopped || checking) return;
    checking = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_FORM_CAPTURE_CONTEXT' });
      if (stopped) return;
      const nextToken = response?.token || null;
      if (nextToken !== token) { token = nextToken; lastSignature = ''; }
      await capture();
    } catch { token = null; } finally { checking = false; }
  }

  const listen = (target, name, handler) => {
    target.addEventListener(name, handler, true);
    cleanups.push(() => target.removeEventListener(name, handler, true));
  };
  listen(document, 'input', schedule);
  listen(document, 'change', () => { void capture(); });
  listen(document, 'focusout', () => { void capture(); });
  // Capture the old DOM synchronously, before the site's handlers replace it.
  listen(document, 'click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('button, [role="button"], input[type="submit"], a') : null;
    if (button) void capture();
    schedule();
  });
  listen(document, 'submit', () => { void capture(); });
  listen(document, 'keydown', (event) => { if (event.key === 'Enter') void capture(); });
  listen(window, 'pagehide', () => { void capture(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) void capture(); });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-checked', 'aria-pressed', 'aria-selected', 'aria-valuetext', 'aria-controls', 'aria-owns', 'aria-hidden', 'value', 'hidden'],
  });
  const onMessage = (message, _sender, respond) => {
    if (message?.type === 'APPLICATION_CAPTURE_START') {
      refreshContext().then(() => respond({ ok: true, captureReady: true }));
      return true;
    }
    if (message?.type === 'APPLICATION_CAPTURE_FLUSH') {
      capture().then(() => respond({ ok: true }));
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  void refreshContext();
  // Also observes autofill/programmatic changes that do not dispatch input events.
  const interval = setInterval(refreshContext, 2000);
  globalThis.__resumeAiFormCapture = { stop: () => {
    stopped = true;
    token = null;
    clearTimeout(queued);
    clearInterval(interval);
    observer.disconnect();
    cleanups.forEach((cleanup) => cleanup());
    chrome.runtime.onMessage.removeListener(onMessage);
  } };
})();
