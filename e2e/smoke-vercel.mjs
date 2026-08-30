import { chromium } from 'playwright-core';

const BASE_URL = (process.env.E2E_BASE_URL || 'https://edge-yc7z.vercel.app').replace(/\/+$/, '');

async function assertNoLocalhostInPage(page, label) {
  const html = await page.content();
  if (/http:\/\/localhost(?::\d+)?/i.test(html) && !html.includes('vite')) {
    // Soft check: production marketing/login should not advertise localhost invite hosts.
    console.warn(`[warn] ${label}: page HTML mentions localhost`);
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.E2E_BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const failures = [];

  try {
    // 1) Public shell loads
    const home = await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!home || home.status() >= 500) {
      failures.push(`Home returned status ${home?.status()}`);
    }
    await assertNoLocalhostInPage(page, 'home');

    // 2) Auth/login route reachable
    await page.goto(BASE_URL + '/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const bodyText = await page.locator('body').innerText();
    if (!/sign in|log in|email|password|EDGE/i.test(bodyText)) {
      failures.push('Auth page did not show expected sign-in content');
    }

    // 3) Protected engagement routes redirect when anonymous
    for (const path of ['/dashboard/my-engagement', '/dashboard/student-engagement']) {
      await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const url = page.url();
      if (url.includes(path) && !/auth|login|sign/i.test(url)) {
        // May still be on dashboard shell with redirect — check we are not fully authenticated empty
        const text = await page.locator('body').innerText();
        if (/My Engagement|Student Engagement Monitoring/i.test(text) && !/sign in|log in/i.test(text)) {
          failures.push(`${path} appears accessible without auth`);
        }
      }
    }

    // 4) Cron endpoint exists (401 without secret is OK; 404 is not)
    const cronRes = await page.request.get(BASE_URL + '/api/cron/scan-engagement');
    if (cronRes.status() === 404) {
      failures.push('Cron path /api/cron/scan-engagement returned 404');
    } else {
      console.log(`Cron endpoint status: ${cronRes.status()} (401/500 OK if secrets unset)`);
    }

    // 5) SPA rewrite still serves app for deep links
    const deep = await page.goto(BASE_URL + '/request-staff-account', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!deep || deep.status() >= 500) {
      failures.push(`Deep link status ${deep?.status()}`);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error('E2E smoke failures:');
    for (const f of failures) console.error(' -', f);
    process.exit(1);
  }

  console.log(`E2E smoke OK against ${BASE_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
