const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'assets', 'screenshots');

async function capture() {
  console.log('Starting playwright...');
  
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log('Navigating to login...');
  await page.goto('http://localhost:5173/login');
  
  // Wait for login form
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', 'admin@netlink.com');
  await page.fill('input[type="password"]', 'admin@123');
  
  console.log('Submitting login...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button[type="submit"]')
  ]);

  console.log('Logged in. Waiting for dashboard to settle...');
  await page.waitForTimeout(2000); // let things render

  const routesToCapture = [
    { route: '/dashboard', filename: 'hero-dashboard.png' },
    { route: '/workflows', filename: 'tab-workflow.png' },
    { route: '/documents', filename: 'tab-document.png' },
    { route: '/s3-storage', filename: 'tab-storage.png' },
    { route: '/roles', filename: 'tab-security.png' },
    { route: '/forms', filename: 'usecase-hr.png' },
    { route: '/billing', filename: 'usecase-finance.png' },
    { route: '/tasks', filename: 'usecase-it.png' },
    { route: '/usage', filename: 'usecase-ops.png' },
    { route: '/audit-log', filename: 'usecase-legal.png' }
  ];

  for (const item of routesToCapture) {
    console.log(`Navigating to ${item.route}...`);
    try {
      await page.goto(`http://localhost:5173${item.route}`, { waitUntil: 'networkidle', timeout: 5000 });
      await page.waitForTimeout(1000); // let animations or skeleton loaders finish
      
      const outPath = path.join(OUT_DIR, item.filename);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`Saved ${item.filename}`);
    } catch (err) {
      console.error(`Failed to capture ${item.route}: ${err.message}`);
    }
  }

  await browser.close();
  console.log('Done.');
}

capture().catch(console.error);
