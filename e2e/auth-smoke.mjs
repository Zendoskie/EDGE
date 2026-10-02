import { chromium } from 'playwright-core';

const BASE_URL = (process.env.E2E_BASE_URL || 'https://edge-yc7z.vercel.app').replace(/\/+$/, '');

async function main() {
  const browser = await chromium.launch({
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const failures = [];

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const signInTab = page.getByRole('tab', { name: /sign in/i });
    const signUpTab = page.getByRole('tab', { name: /sign up/i });
    if (!(await signInTab.count())) failures.push('Missing Sign In tab');
    if (!(await signUpTab.count())) failures.push('Missing Sign Up tab');

    await signUpTab.click();
    await page.getByLabel(/student no\./i).waitFor({ timeout: 10_000 });
    if (await page.getByLabel(/parent gmail/i).count()) {
      failures.push('Student signup still shows Parent Gmail field');
    }

    const roleTrigger = page.locator('#signup-role');
    if (await roleTrigger.count()) {
      await roleTrigger.click();
      await page.getByRole('option', { name: /parent/i }).click();
    } else {
      const nativeRole = page.locator('select').first();
      if (await nativeRole.count()) await nativeRole.selectOption('parent');
      else failures.push('Missing signup role selector');
    }
    const guardian = page.getByLabel(/^student id$/i);
    if (!(await guardian.count())) failures.push('Parent signup missing Student ID field');

    await signInTab.click();
    const staffLink = page.getByRole('link', { name: /request staff account/i });
    if (!(await staffLink.count())) failures.push('Missing staff account request link');
    else {
      await staffLink.click();
      await page.waitForURL(/request-staff-account/, { timeout: 15_000 });
      const staffBody = await page.locator('body').innerText();
      if (!/staff|instructor|counselor|request/i.test(staffBody)) {
        failures.push('Staff request page missing expected content');
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error('Auth smoke failures:');
    for (const f of failures) console.error(' -', f);
    process.exit(1);
  }
  console.log(`Auth smoke OK against ${BASE_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
