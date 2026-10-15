// UI smoke test: drives the running app in headless Edge/Chrome, walks the main flows and saves screenshots.
// Usage: node scripts/ui-smoke.mjs [baseUrl] [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = process.argv[3] ?? 'screenshots';
const SUPER = { email: process.env.SA_EMAIL ?? 'admin@saiassist.local', password: process.env.SA_PASSWORD ?? 'Admin@12345' };
const DEALER = { email: process.env.DA_EMAIL ?? 'admin@saimotors.demo', password: process.env.DA_PASSWORD ?? 'Demo@12345' };
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });

async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`[console] ${page.url()} ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} ${e.message}`));
  page.on('response', (r) => r.status() >= 500 && problems.push(`[http ${r.status()}] ${r.url()}`));
  return page;
}

const shot = async (page, name, full = true) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('saved', name);
};

async function login(page, who) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email address').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|admin)/);
  await page.waitForLoadState('networkidle');
}

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    problems.push(`[step failed] ${name}: ${e.message.split('\n')[0]}`);
    console.log('FAILED', name, e.message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------- public & mobile
const mobile = await newPage({ width: 390, height: 844 });
await step('login mobile', async () => {
  await mobile.goto(`${BASE}/login`);
  await mobile.waitForLoadState('networkidle');
  await shot(mobile, '01-login-mobile', false);
});

const desk = await newPage();
await step('login desktop', async () => {
  await desk.goto(`${BASE}/login`);
  await desk.waitForLoadState('networkidle');
  await shot(desk, '02-login-desktop', false);
});

// ---------------------------------------------------------------- dealer flows
let issuedNumber = null;
await step('dealer login', () => login(desk, DEALER));
await step('dealer dashboard', async () => {
  await desk.waitForSelector('text=Recent policies');
  await shot(desk, '10-dealer-dashboard');
});
await step('issue wizard', async () => {
  await desk.goto(`${BASE}/app/issue`);
  await desk.waitForSelector('text=Find the customer');
  await shot(desk, '11-wizard-customer-search', false);
  await desk.getByRole('button', { name: 'New customer' }).first().click();
  await desk.getByLabel('Customer name').fill('ANJALI VINOD KULKARNI');
  await desk.getByLabel('Mobile number').fill('9822012345');
  await desk.getByLabel('Email').fill('anjali.k@example.com');
  await desk.getByLabel('Date of birth').fill('1991-06-21');
  await desk.getByLabel('Pincode').fill('416003');
  await desk.getByLabel('Address').fill('Plot 7, Rajarampuri 5th Lane');
  await desk.getByLabel('City').fill('Kolhapur');
  await shot(desk, '12-wizard-new-customer', false);
  await desk.getByRole('button', { name: 'Save & continue' }).click();
  await desk.waitForSelector('text=Add vehicle');
  await desk.getByLabel('New vehicle - registration pending').check();
  await desk.getByLabel('Make').fill('Honda');
  await desk.getByLabel('Model').fill('Activa 6G');
  await desk.getByLabel('Variant').fill('DLX Smart Key');
  await desk.getByLabel('Engine number').fill('JF89EG7654321');
  await desk.getByLabel('Chassis number').fill('ME4JF89DLTG765432');
  await shot(desk, '13-wizard-new-vehicle', false);
  await desk.getByRole('button', { name: 'Save & continue' }).click();
  await desk.waitForSelector('text=Choose the RSA plan');
  await desk.waitForSelector('text=Coverage period');
  await desk.waitForTimeout(1200);
  await shot(desk, '14-wizard-plan');
  await desk.getByRole('button', { name: /^Continue/ }).click();
  await desk.waitForSelector('text=Payment details');
  await desk.getByLabel('Transaction / reference no.').fill('UPI6281734501');
  await shot(desk, '15-wizard-payment', false);
  await desk.getByRole('button', { name: /Preview certificate/ }).click();
  await desk.waitForSelector('canvas', { timeout: 30000 });
  await desk.waitForTimeout(1500);
  await shot(desk, '16-wizard-preview');
  await desk.getByRole('button', { name: /Confirm & issue certificate/ }).click();
  await desk.waitForSelector('text=RSA policy issued successfully', { timeout: 30000 });
  issuedNumber = (await desk.locator('p.font-mono').first().textContent())?.trim();
  await shot(desk, '17-wizard-done', false);
});
await step('policies list', async () => {
  await desk.goto(`${BASE}/app/policies`);
  await desk.waitForSelector('text=Certificate No.');
  await desk.waitForLoadState('networkidle');
  await shot(desk, '18-policies');
});
await step('policy detail', async () => {
  await desk.goto(`${BASE}/app/policies?q=${issuedNumber ?? ''}`);
  await desk.waitForLoadState('networkidle');
  await desk.locator('tbody tr').first().click();
  await desk.waitForSelector('text=Certificate information');
  await desk.waitForLoadState('networkidle');
  await shot(desk, '19-policy-detail');
});
await step('customers', async () => {
  await desk.goto(`${BASE}/app/customers`);
  await desk.waitForLoadState('networkidle');
  await shot(desk, '20-customers', false);
});
await step('reports dealer', async () => {
  await desk.goto(`${BASE}/app/reports`);
  await desk.waitForSelector('text=Total sales');
  await desk.waitForLoadState('networkidle');
  await shot(desk, '21-dealer-reports');
});
await step('employees', async () => {
  await desk.goto(`${BASE}/app/employees`);
  await desk.waitForLoadState('networkidle');
  await shot(desk, '22-employees', false);
});
await step('dealer settings', async () => {
  await desk.goto(`${BASE}/app/settings`);
  await desk.waitForLoadState('networkidle');
  await shot(desk, '23-dealer-settings');
});
await step('cancellations', async () => {
  await desk.goto(`${BASE}/app/cancellations`);
  await desk.waitForLoadState('networkidle');
  await shot(desk, '24-cancellations', false);
});
await step('mobile dashboard', async () => {
  await login(mobile, DEALER);
  await mobile.waitForSelector('text=Recent policies');
  await shot(mobile, '25-dealer-dashboard-mobile');
});

// ---------------------------------------------------------------- public verification
await step('verify', async () => {
  const pub = await newPage({ width: 1280, height: 900 });
  await pub.goto(`${BASE}/verify/${issuedNumber ?? 'SA0000'}`);
  await pub.waitForSelector('text=Genuine certificate');
  await shot(pub, '30-verify', false);
});

// ---------------------------------------------------------------- super admin
const admin = await newPage();
await step('admin login', () => login(admin, SUPER));
await step('admin dashboard', async () => {
  await admin.waitForSelector('text=Platform overview');
  await admin.waitForLoadState('networkidle');
  await shot(admin, '40-admin-dashboard');
});
await step('dealers', async () => {
  await admin.goto(`${BASE}/admin/dealers`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, '41-dealers', false);
  await admin.locator('tbody tr').first().click();
  await admin.waitForSelector('text=Certificate details');
  await admin.getByRole('button', { name: 'Products & pricing' }).click();
  await admin.waitForLoadState('networkidle');
  await shot(admin, '42-dealer-products');
});
await step('new dealer form', async () => {
  await admin.goto(`${BASE}/admin/dealers/new`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, '43-dealer-onboard');
});
await step('products', async () => {
  await admin.goto(`${BASE}/admin/products`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, '44-products', false);
  await admin.locator('tbody tr').first().click();
  await admin.waitForSelector('text=Roadside assistance benefits');
  await shot(admin, '45-product-form');
});
await step('settings template', async () => {
  await admin.goto(`${BASE}/admin/settings`);
  await admin.waitForLoadState('networkidle');
  await admin.getByRole('button', { name: 'Certificate template' }).click();
  await shot(admin, '46-settings-template', false);
});
await step('admin reports', async () => {
  await admin.goto(`${BASE}/admin/reports`);
  await admin.waitForSelector('text=Dealer-wise performance');
  await admin.waitForLoadState('networkidle');
  await shot(admin, '47-admin-reports');
});
await step('admin policies', async () => {
  await admin.goto(`${BASE}/admin/policies`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, '48-admin-policies', false);
});
await step('audit', async () => {
  await admin.goto(`${BASE}/admin/audit`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, '49-audit', false);
});

await browser.close();
console.log(`\nIssued during test: ${issuedNumber}`);
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join('\n')}` : '\nNo console errors, page errors or 5xx responses.');
