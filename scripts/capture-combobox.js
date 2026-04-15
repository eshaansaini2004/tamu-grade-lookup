// Interact with the combobox selects on /courses/add to trigger the POST.
// Usage: node scripts/capture-combobox.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
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

  // Navigate straight to courses/add
  await page.goto(`${BASE}/entry`);
  await page.waitForLoadState('networkidle');
  const radios = page.locator('input[type="radio"]');
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const label = await radios.nth(i).evaluate(el =>
      document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ?? el.value
    );
    if (label.includes('Spring 2026 - College Station')) { await radios.nth(i).click(); break; }
  }
  await page.locator('button').filter({ hasText: /save and continue/i }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Navigate to courses/add directly
  await page.goto(`${BASE}/terms/${encodeURIComponent(TERM)}/courses/add`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('On:', page.url());

  // Use getByRole to find comboboxes
  const comboboxes = page.getByRole('combobox');
  const cbCount = await comboboxes.count();
  console.log(`Comboboxes: ${cbCount}`);

  if (cbCount >= 1) {
    // Click the first combobox (Subject)
    const subjectCb = comboboxes.nth(0);
    await subjectCb.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/cb-subject-open.png' });

    // The options should appear — search for CSCE
    await page.keyboard.type('CSCE');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/cb-subject-typed.png' });

    // Click the CSCE option
    const csceOpt = page.getByRole('option').filter({ hasText: /^CSCE/i }).first();
    if (await csceOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await csceOpt.click();
      console.log('Selected CSCE subject');
      await page.waitForTimeout(1500);
    } else {
      // Try pressing Enter or Down+Enter
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: '/tmp/cb-subject-selected.png' });
  }

  if (cbCount >= 2) {
    // Click the second combobox (Course number)
    const courseCb = comboboxes.nth(1);
    await courseCb.click();
    await page.waitForTimeout(800);

    await page.keyboard.type('110');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/cb-course-typed.png' });

    const courseOpt = page.getByRole('option').first();
    if (await courseOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await courseOpt.click();
      console.log('Selected course');
      await page.waitForTimeout(800);
    } else {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: '/tmp/cb-course-selected.png' });
  }

  // Click + Add Course button
  const addBtn = page.locator('button').filter({ hasText: /add course/i }).last();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Clicking Add Course...');
    await addBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/after-add-course.png' });
  }

  console.log('\n=== Captured requests ===');
  if (captured.length === 0) {
    console.log('None captured.');
    // Print full raw HTML of the form area
    const html = await page.evaluate(() => document.querySelector('main')?.innerHTML?.slice(0, 2000));
    console.log('\nMain HTML:', html);
  } else {
    for (const r of captured) {
      console.log(`\n${r.method} ${r.url}`);
      const h = Object.entries(r.headers).filter(([k]) =>
        ['rf-token', 'x-requested-with', 'content-type'].includes(k.toLowerCase())
      );
      console.log('  Key headers:', JSON.stringify(Object.fromEntries(h)));
      if (r.body) console.log('  Body:', r.body);
      console.log('  Status:', r.status);
      if (r.response) console.log('  Response:', r.response.slice(0, 300));
    }
  }

  await context.close();
})();
