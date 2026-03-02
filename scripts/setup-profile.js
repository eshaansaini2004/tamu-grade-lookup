// Run once to create a persistent Chrome profile with TAMU SSO saved.
// Usage: node scripts/setup-profile.js
//
// A browser window will open. Log in manually (SSO + Duo), navigate to
// the Schedule Builder home page, then close the browser. Done.

import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const PROFILE_PATH = path.join(os.homedir(), '.tamu_playwright_profile');

(async () => {
  console.log(`Launching browser with profile at: ${PROFILE_PATH}`);
  console.log('Log in manually, then close the browser window when done.\n');

  const context = await chromium.launchPersistentContext(PROFILE_PATH, {
    headless: false,
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();
  await page.goto('https://tamu.collegescheduler.com');

  // Wait until the user closes the browser
  await context.waitForEvent('close').catch(() => {});
  console.log('Profile saved. Run automation scripts with PROFILE_PATH set.');
})();
