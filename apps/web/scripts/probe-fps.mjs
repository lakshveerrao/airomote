import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5173/setup');
await page.evaluate((q) => { localStorage.setItem('aero.settings.v1', JSON.stringify({ state: { setupComplete: true, developerMode: true }, version: 0 })); if (q) localStorage.setItem('aero.sceneQuality', q); }, process.env.QUALITY || '');
const fps = async () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(Math.round(n / 1.5)); }; requestAnimationFrame(f); }));
const out = {};
for (const path of ['/music/drums', '/games/motion-kart', '/workout/squats', '/music/guitar']) {
  await page.goto('http://127.0.0.1:5173' + path, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await window.__aero.controllerManager.connect(1, 'simulator'); });
  await page.waitForTimeout(1500);
  const intro = await fps();
  for (let i = 0; i < 4; i++) { const n = page.getByRole('button', { name: /skip|next/i }); if (await n.count()) await n.first().click().catch(() => {}); await page.waitForTimeout(100); }
  await page.getByRole('button', { name: /start/i }).click().catch(() => {});
  await page.waitForTimeout(2500);
  const running = await fps();
  const rate = await page.evaluate(() => window.__aero.controllerManager.slots[1].packetRateHz);
  out[path] = { intro, running, packetRateHz: rate };
}
console.log(JSON.stringify(out));
await browser.close();
