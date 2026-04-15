// Select Spring 2026, click Add Course, search, click Add, capture request.
// Usage: node scripts/capture-add-course-modal.js

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

  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() !== 'GET' && url.includes('collegescheduler') && !url.includes('analytics') && !url.includes('saml')) {
      captured.push({
        method: req.method(),
        url: url.replace(BASE, ''),
        headers: req.headers(),
        body: req.postData()?.slice(0, 800),
        ts: Date.now(),
      });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (req.method() !== 'GET' && req.url().includes('collegescheduler') && !req.url().includes('analytics')) {
      const entry = captured.find(c => req.url().replace(BASE, '') === c.url);
      if (entry && !entry.status) {
        entry.status = res.status();
        try { entry.response = (await res.text()).slice(0, 400); } catch {}
      }
    }
  });

  // Navigate to entry and select Spring 2026
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const label = await radios.nth(i).evaluate(el => {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      return lbl?.textContent?.trim() ?? el.value;
    });
    if (label.includes('Spring 2026 - College Station')) {
      await radios.nth(i).click();
      break;
    }
  }

  const saveBtn = page.locator('button').filter({ hasText: /save and continue/i }).first();
  await saveBtn.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('URL after save:', page.url());
  await page.screenshot({ path: '/tmp/options-page.png' });

  // Click Add Course button
  console.log('Clicking Add Course...');
  const addCourseBtn = page.locator('button, a').filter({ hasText: /add cou/i }).first();
  await addCourseBtn.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/after-add-course-click.png' });

  // Check what appeared (modal, inline form, etc.)
  const afterClick = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('input, select, [role="dialog"], [role="modal"], [class*="modal"], [class*="dialog"]'))
      .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0)
      .map(el => `${el.tagName.toLowerCase()}[class="${el.className?.toString().slice(0, 40)}"] placeholder="${el.placeholder ?? ''}"`)
      .slice(0, 10);
    return visible;
  });
  console.log('Elements after click:', afterClick);

  // Try to type in any visible input
  const inputs = page.locator('input[type="text"], input:not([type])');
  const inputCount = await inputs.count();
  console.log(`Inputs after click: ${inputCount}`);

  if (inputCount > 0) {
    const firstInput = inputs.first();
    if (await firstInput.isVisible({ timeout: 2000 })) {
      console.log('Typing CSCE 312...');
      await firstInput.click();
      await firstInput.fill('CSCE');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '/tmp/after-search-input.png' });

      // Look for dropdown options or results
      const options = await page.locator('[role="option"], li[class*="option"], [class*="result"]').all();
      console.log(`Options found: ${options.length}`);

      // Also check for any select/react-select components
      const selectOptions = await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('[class*="option"], [id*="option"]'));
        return opts.slice(0, 5).map(o => o.textContent?.trim().slice(0, 50));
      });
      console.log('Select options:', selectOptions);

      if (options.length > 0) {
        await options[0].click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: '/tmp/after-option-click.png' });
      }
    }
  }

  // Now look for a "number" input and fill in course number
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/course-form.png' });

  // Try to find submit/add button
  const submitBtn = page.locator('button').filter({ hasText: /^add$|^submit$|^search$/i }).first();
  if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking submit/add button...');
    await submitBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/after-submit.png' });
  }

  console.log('\n=== Captured non-GET requests ===');
  if (captured.length === 0) {
    console.log('None captured.');
    // Print full DOM to understand the state
    const dom = await page.evaluate(() => {
      const getEl = (el, d = 0) => {
        if (d > 3) return '';
        const tag = el.tagName?.toLowerCase();
        const cls = el.className?.toString().slice(0, 50);
        const txt = el.textContent?.trim().slice(0, 40);
        let out = `${'  '.repeat(d)}<${tag} class="${cls}">${txt}\n`;
        for (const c of Array.from(el.children).slice(0, 6)) out += getEl(c, d + 1);
        return out;
      };
      return getEl(document.body);
    });
    console.log('\nPage DOM:\n', dom.slice(0, 4000));
  } else {
    for (const r of captured) {
      console.log(`\n${r.method} ${r.url}`);
      const csrfH = Object.entries(r.headers).filter(([k]) =>
        ['rf-token', 'requestverificationtoken', 'x-requested-with', 'content-type'].includes(k.toLowerCase())
      );
      if (csrfH.length) console.log('  Headers:', JSON.stringify(Object.fromEntries(csrfH)));
      if (r.body) console.log('  Body:', r.body);
      console.log('  Status:', r.status);
      if (r.response) console.log('  Response:', r.response.slice(0, 200));
    }
  }

  await context.close();
})();
