// Usage: node scripts/screenshot-music.mjs <drums|guitar> <out-prefix> [width] [height]
// Seeds setup-done + developer mode, connects two simulated controllers, walks through the
// intro, starts the activity, drives simulator gestures and captures screenshots.
import { chromium } from 'playwright';

const [, , which = 'drums', prefix = '/tmp/music', w = '1440', h = '900'] = process.argv;
const base = process.env.AERO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(base + '/setup');
await page.evaluate(() => {
  const key = 'aero.settings.v1';
  const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
  cur.state = { ...cur.state, setupComplete: true, developerMode: true };
  localStorage.setItem(key, JSON.stringify(cur));
});
await page.goto(base + '/music/' + which, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const a = window.__aero;
  await a.controllerManager.connect(1, 'simulator');
  await a.controllerManager.connect(2, 'simulator');
});
await page.waitForTimeout(2800); // let the simulated calibration finish
await page.screenshot({ path: `${prefix}-intro.png` });
// walk the intro
for (let i = 0; i < 4; i++) {
  const next = page.getByRole('button', { name: /next/i });
  if (await next.count()) await next.first().click();
  else break;
  await page.waitForTimeout(150);
}
await page.getByRole('button', { name: /start/i }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${prefix}-running.png` });

if (which === 'drums') {
  await page.evaluate(() => {
    const m = window.__aero.controllerManager;
    m.getSimulator(1).model.targetYawRate = 0;
    m.getSimulator(2).model.setPose(30, 0); // raise stick 2 → cymbals
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.strike(0.9));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(2).model.strike(0.7));
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${prefix}-hit.png` });
  await page.waitForTimeout(400);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.strike(0.6));
    await page.waitForTimeout(160);
    await page.evaluate(() => window.__aero.controllerManager.getSimulator(2).model.strike(0.8));
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${prefix}-roll.png` });
} else {
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.setPose(0, 40)); // tilt right → G
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(2).model.swing('down', 0.85));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${prefix}-strum.png` });
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.setPose(-40, 0)); // forward → Am
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__aero.controllerManager.getSimulator(2).model.swing('up', 0.5));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${prefix}-strum2.png` });
}
const hud = await page.evaluate(() => document.querySelector('.hud-bottom')?.textContent ?? '');
console.log('HUD:', hud.slice(0, 200));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
