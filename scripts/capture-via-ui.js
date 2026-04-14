// Select Spring 2026, navigate to courses, add one, capture the request.
// Usage: node scripts/capture-via-ui.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);
const BASE = 'https://tamu.collegescheduler.com';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Capture all non-GET, non-analytics requests with full headers
  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() !== 'GET' && url.includes('collegescheduler') && !url.includes('analytics') && !url.includes('saml')) {
      captured.push({
        method: req.method(),
        url: url.replace(BASE, ''),
        headers: req.headers(),
        body: req.postData()?.slice(0, 800),
      });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    const url = req.url();
    if (req.method() !== 'GET' && url.includes('collegescheduler') && !url.includes('analytics') && !url.includes('saml')) {
      const entry = captured.find(c => url.endsWith(c.url) || c.url === url.replace(BASE, ''));
      if (entry && !entry.status) {
        entry.status = res.status();
        try { entry.response = (await res.text()).slice(0, 400); } catch {}
      }
    }
  });

  // Start at the term entry page
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Select Spring 2026 - College Station
  console.log('Selecting Spring 2026...');
  const springLabel = page.locator('label, span').filter({ hasText: /^Spring 2026 - College Station$/ }).first();
  if (await springLabel.isVisible({ timeout: 5000 })) {
    await springLabel.click();
  } else {
    // Try radio buttons directly
    const radios = page.locator('input[type="radio"]');
    const count = await radios.count();
    console.log(`Found ${count} radio buttons`);
    for (let i = 0; i < count; i++) {
      const label = await radios.nth(i).evaluate(el => {
        const id = el.id;
        const lbl = document.querySelector(`label[for="${id}"]`);
        return lbl?.textContent?.trim() ?? el.value;
      });
      if (label.includes('Spring 2026 - College Station')) {
        await radios.nth(i).click();
        console.log('Clicked radio for Spring 2026');
        break;
      }
    }
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/after-term-select.png' });

  // Click Save and Continue
  console.log('Clicking Save and Continue...');
  const saveBtn = page.locator('button').filter({ hasText: /save and continue/i }).first();
  if (await saveBtn.isVisible({ timeout: 3000 })) {
    await saveBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  }

  console.log('Current URL:', page.url());
  await page.screenshot({ path: '/tmp/after-save.png' });

  // Now we should be in the courses view — take screenshot
  const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('Page text:', pageText);

  // Look for a course search input
  await page.waitForTimeout(2000);
  const inputs = await page.locator('input[type="text"], input[placeholder]').all();
  console.log(`Inputs found: ${inputs.length}`);

  // Try to find and use the course search
  let searched = false;
  for (const input of inputs) {
    const ph = await input.getAttribute('placeholder');
    const type = await input.getAttribute('type');
    if (ph || type === 'text') {
      console.log(`Trying input placeholder="${ph}" type="${type}"`);
      await input.click();
      await input.fill('CSCE');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '/tmp/after-search.png' });

      // Look for course results
      const courseItems = await page.locator('[class*="course"], li, [role="option"]').all();
      console.log(`Items after search: ${courseItems.length}`);

      if (courseItems.length > 0) {
        searched = true;
        // Click first result
        await courseItems[0].click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: '/tmp/after-click-course.png' });
        break;
      }
    }
  }

  // Also try clicking "Add Course" or similar buttons
  const addBtn = page.locator('button, a').filter({ hasText: /^add course|add$/i }).first();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Found Add button, clicking...');
    await addBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/after-add.png' });
  }

  // Final screenshot
  await page.screenshot({ path: '/tmp/courses-final.png', fullPage: true });

  console.log('\n=== Captured non-GET requests ===');
  if (captured.length === 0) {
    console.log('None. Page probably still on term selection or no actions triggered writes.');

    // Print all GET API calls to understand the page state
    const allGets = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/') && req.url().includes('collegescheduler')) {
        allGets.push(req.url().replace(BASE, ''));
      }
    });
  } else {
    for (const r of captured) {
      console.log(`\n${r.method} ${r.url}`);
      const csrfHeaders = Object.entries(r.headers).filter(([k]) =>
        k.toLowerCase().includes('token') || k.toLowerCase().includes('csrf') || k.toLowerCase().includes('verification') || k === 'rf-token'
      );
      if (csrfHeaders.length) console.log('  CSRF headers:', JSON.stringify(Object.fromEntries(csrfHeaders)));
      if (r.body) console.log('  Body:', r.body);
      console.log('  Status:', r.status);
      if (r.response) console.log('  Response:', r.response);
    }
  }

  await context.close();
})();
