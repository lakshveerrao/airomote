// Usage: node scripts/screenshot-workout.mjs <squats|pushups> <outPrefix> [width] [height]
//   Drives the workout flow end-to-end against the dev server with two simulated controllers:
//   intro → Start → calibration → 3 simulated reps → screenshot running → Finish → screenshot summary.
import { chromium } from 'playwright';

const [, , exercise = 'squats', prefix = '/tmp/workout', w = '1440', h = '900'] = process.argv;
const base = process.env.AERO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(base + '/setup');
await page.evaluate(() => {
  const key = 'aero.settings.v1';
  const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
  cur.state = { ...cur.state, setupComplete: true, developerMode: true };
  localStorage.setItem(key, JSON.stringify(cur));
});
await page.goto(`${base}/workout/${exercise}`, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  await window.__aero.controllerManager.connect(1, 'simulator');
});
await page.waitForTimeout(2800); // simulator calibration
await page.screenshot({ path: `${prefix}-intro.png` });
await page.getByRole('button', { name: 'Skip' }).click().catch(() => undefined);
await page.getByRole('button', { name: /Start/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${prefix}-calibrating.png` });
await page.waitForTimeout(1400);
for (let i = 0; i < 3; i++) {
  await page.evaluate((ex) => {
    const m = window.__aero.controllerManager.getSimulator(1).model;
    if (ex === 'squats') m.simulateSquat();
    else m.simulatePushup();
  }, exercise);
  await page.waitForTimeout(exercise === 'squats' ? 2300 : 2600);
}
await page.screenshot({ path: `${prefix}-running.png` });
const reps = await page.locator('.hud-big').innerText();
await page.getByRole('button', { name: /Finish/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${prefix}-summary.png` });
console.log(`reps counted: ${reps.trim()} → ${prefix}-{intro,calibrating,running,summary}.png (${w}x${h})`);
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
