// Usage: node scripts/screenshot-factory.mjs [out.png] [width] [height]
//   Opens /settings/factory, connects a simulated controller, runs the tests, drives the
//   simulator through the tilt/twist prompts, and screenshots the final verdict.
import { chromium } from 'playwright';

const [, , out = '/tmp/factory-pass.png', w = '1440', h = '900'] = process.argv;
const base = process.env.AERO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(base + '/setup');
await page.evaluate(() => {
  const key = 'aero.settings.v1';
  const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
  cur.state = { ...cur.state, setupComplete: true, developerMode: true };
  localStorage.setItem(key, JSON.stringify(cur));
});
await page.goto(base + '/settings/factory', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Simulated (demo)' }).click();
await page.waitForTimeout(2800); // calibration
await page.getByRole('button', { name: 'Run tests' }).click();
// Wait for the tilt prompt then drive the simulator model.
await page.waitForSelector('.prompt-banner', { timeout: 20000 });
await page.evaluate(() => {
  const sim = window.__aero.controllerManager.getSimulator(1);
  sim.model.targetPitch = 60;
  setTimeout(() => {
    sim.model.targetYawRate = 250;
    setTimeout(() => {
      sim.model.targetYawRate = 0;
      sim.model.targetPitch = 0;
    }, 1200);
  }, 900);
});
await page.waitForSelector('.verdict', { timeout: 40000 });
await page.waitForTimeout(600);
await page.screenshot({ path: out });
const verdict = await page.locator('.verdict h1').innerText();
console.log(`saved ${out} — ${verdict}`);
if (errors.length) console.log(errors.join('\n'));
else console.log('no console errors');
await browser.close();
