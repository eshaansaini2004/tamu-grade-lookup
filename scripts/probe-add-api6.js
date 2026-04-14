// Navigate the real UI, click Add on a course, capture the exact request.
// Usage: node scripts/probe-add-api6.js

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false, // visible so we can see what's happening
    args: ['--no-first-run'],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Capture ALL non-analytics requests
  const captured = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('collegescheduler') && !url.includes('google') && !url.includes('analytics')) {
      captured.push({
        method: req.method(),
        url: url.replace('https://tamu.collegescheduler.com', ''),
        headers: Object.fromEntries(
          Object.entries(req.headers()).filter(([k]) => !k.startsWith(':'))
        ),
        body: req.postData()?.slice(0, 600),
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('collegescheduler') && !url.includes('analytics')) {
      const entry = captured.find((c) => c.url === url.replace('https://tamu.collegescheduler.com', ''));
      if (entry && res.request().method() !== 'GET') {
        entry.status = res.status();
        try { entry.response = (await res.text()).slice(0, 300); } catch {}
      }
    }
  });

  // Go to the courses search page
  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take a screenshot to see the page state
  await page.screenshot({ path: '/tmp/scheduler-courses.png' });
  console.log('Screenshot saved to /tmp/scheduler-courses.png');

  // Print page content summary
  const pageInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20);
    const inputs = Array.from(document.querySelectorAll('input')).map(i => `${i.type}:${i.placeholder || i.name}`).slice(0, 10);
    const links = Array.from(document.querySelectorAll('a')).map(a => a.textContent?.trim()).filter(Boolean).slice(0, 10);
    return { url: location.href, buttons, inputs, links };
  });
  console.log('Page info:', JSON.stringify(pageInfo, null, 2));

  // Try to find the search input and search for CSCE 312
  const searchInputs = page.locator('input[type="text"], input[placeholder]');
  const count = await searchInputs.count();
  console.log(`Found ${count} inputs`);

  if (count > 0) {
    // Try the first input
    const first = searchInputs.first();
    const isVisible = await first.isVisible();
    if (isVisible) {
      await first.click();
      await first.fill('CSCE');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '/tmp/scheduler-after-search.png' });
      console.log('After search screenshot saved');

      // Look for course results
      const courseButtons = await page.locator('button').filter({ hasText: /add|select/i }).all();
      console.log(`Found ${courseButtons.length} add/select buttons after search`);

      if (courseButtons.length > 0) {
        console.log('Clicking first Add button...');
        await courseButtons[0].click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/tmp/scheduler-after-add.png' });
        console.log('After add screenshot saved');
      }
    }
  }

  // Print all non-GET captured requests
  const nonGet = captured.filter(c => c.method !== 'GET');
  console.log(`\n=== Non-GET requests captured (${nonGet.length}) ===`);
  for (const r of nonGet) {
    console.log(`\n${r.method} ${r.url}`);
    if (r.headers) {
      const interestingHeaders = Object.entries(r.headers).filter(([k]) =>
        ['content-type', 'requestverificationtoken', '__requestverificationtoken', 'x-requested-with', 'authorization'].includes(k.toLowerCase())
      );
      if (interestingHeaders.length) console.log('  Headers:', Object.fromEntries(interestingHeaders));
    }
    if (r.body) console.log('  Body:', r.body);
    if (r.status) console.log('  Status:', r.status);
    if (r.response) console.log('  Response:', r.response);
  }

  if (nonGet.length === 0) {
    console.log('No add action captured. All requests:');
    captured.filter(c => !c.url.includes('analytics')).slice(-10).forEach(r => {
      console.log(` ${r.method} ${r.url}`);
    });
  }

  await page.waitForTimeout(3000);
  await context.close();
})();
