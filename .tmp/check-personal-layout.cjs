const { chromium } = require('../../electron-app/node_modules/playwright-core');
const profile = {
  id: 'layout-preview', name: 'Alex Morgan', careerPath: '',
  createdAt: 1, updatedAt: 1, education: [], certifications: [],
  personalInfo: {
    fullName: 'Alex Taylor Morgan', firstName: 'Alex', middleName: 'Taylor', lastName: 'Morgan',
    title: 'Senior Software Engineer', email: 'alex.morgan@example.com', phone: '+1 (312) 555-0123',
    linkedin: 'https://www.linkedin.com/in/alex-morgan', location: 'Chicago, IL',
    address1: '123 West Madison Street', city: 'Chicago', state: 'Illinois', zip: '60602',
    county: 'Cook', country: 'United States', gender: 'Male', hispanicLatino: 'No',
    ethnicity: 'White', usWorkStatus: 'US citizen', legallyAuthorizedUs: 'Yes', requiresSponsorship: 'No',
  },
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(profile => {
      window.aiProfiles = { list: async () => [profile] };
      window.webAuth = { status: async () => ({ authenticated: true, username: 'bidder' }) };
      localStorage.clear();
    }, profile);
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('button', { name: 'Personal information', exact: true }).click();
    const stage = process.argv[2] || 'after';
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 768], [480, 900], [420, 900], [420, 768], [360, 800]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.locator('dl').first().evaluate(element => {
        let scroller = element.parentElement;
        while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
        const visible = [...document.querySelectorAll('dl')].filter(el => el.checkVisibility());
        const rect = visible.at(-1).getBoundingClientRect();
        return {
          fields: visible.reduce((count, el) => count + el.querySelectorAll('dt').length, 0),
          contentHeight: scroller.scrollHeight, availableHeight: scroller.clientHeight,
          extraScroll: scroller.scrollHeight - scroller.clientHeight,
          horizontalOverflow: scroller.scrollWidth > scroller.clientWidth,
          finalFieldBottom: Math.round(rect.bottom),
        };
      });
      console.log(JSON.stringify({ stage, width, height, ...metrics }));
      if (metrics.fields !== 19 || metrics.horizontalOverflow) throw new Error('Fields missing or horizontal overflow');
      if (width === 420 || width === 1440) await page.screenshot({ path: `.tmp/personal-${stage}-${width}-${height}.png` });
    }
    console.log(JSON.stringify({ errors }));
    if (errors.length) throw new Error('Browser runtime errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
