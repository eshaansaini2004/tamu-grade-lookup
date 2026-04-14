import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE = path.join(os.homedir(), '.tamu_playwright_profile');
const TERM = 'Spring 2026 - College Station';
const TERM_ENC = encodeURIComponent(TERM);

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-first-run'],
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  await page.goto(`https://tamu.collegescheduler.com/terms/${TERM_ENC}/courses`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(4000);

  await page.screenshot({ path: '/tmp/courses-page.png', fullPage: true });
  console.log('Screenshot: /tmp/courses-page.png');

  // Dump the visible DOM structure
  const dom = await page.evaluate(() => {
    const body = document.body;
    const getText = (el, depth = 0) => {
      if (depth > 4) return '';
      const tag = el.tagName?.toLowerCase();
      const cls = el.className?.toString().slice(0, 40);
      const text = el.textContent?.trim().slice(0, 50);
      let out = `${'  '.repeat(depth)}<${tag} class="${cls}">${text ? text.slice(0, 30) : ''}\n`;
      for (const child of Array.from(el.children).slice(0, 5)) {
        out += getText(child, depth + 1);
      }
      return out;
    };
    return getText(body);
  });
  console.log('\nDOM:\n', dom.slice(0, 3000));

  await context.close();
})();
