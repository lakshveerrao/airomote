// Usage: node scripts/screenshot-kart.mjs <outPrefix> [width] [height]
// Seeds setup-done + dev mode, connects two simulators, starts Motion Kart, tilts to steer/accelerate.
import { chromium } from 'playwright';
const [, , prefix = '/tmp/kart', w = '1440', h = '900'] = process.argv;
const base = process.env.AERO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(base + '/setup');
await page.evaluate(() => {
  const key = 'aero.settings.v1';
  const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
  cur.state = { ...cur.state, setupComplete: true, developerMode: true };
  localStorage.setItem(key, JSON.stringify(cur));
});
await page.goto(base + '/games/motion-kart', { waitUntil: 'networkidle' });
await page.evaluate(async () => { const a = window.__aero; await a.controllerManager.connect(1, 'simulator'); });
await page.waitForTimeout(2800);
await page.screenshot({ path: `${prefix}-intro.png` });
for (let i = 0; i < 4; i++) { const next = page.getByRole('button', { name: /next/i }); if (await next.count()) await next.first().click(); await page.waitForTimeout(150); }
await page.getByRole('button', { name: /start/i }).click();
await page.waitForTimeout(4500); // countdown
await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.setPose(-25, 0)); // tip forward → accelerate
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-driving.png` });
await page.evaluate(() => window.__aero.controllerManager.getSimulator(1).model.setPose(-25, 28)); // steer right
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-steer.png` });
const hud = await page.evaluate(() => document.querySelector('.hud')?.textContent ?? '');
console.log('HUD:', hud.replace(/\s+/g, ' ').slice(0, 300));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
