import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/setup', { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const m = window.__aero.controllerManager;
  await m.connect(1, 'simulator');
  const sim = m.getSimulator(1);
  const log = [];
  let maxRate = 0;
  const orig = sim.model.step.bind(sim.model);
  sim.model.step = (dt) => { const s = orig(dt); const r = Math.hypot(s.gyro.x, s.gyro.y); if (r > maxRate) maxRate = r; return s; };
  for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 500)); log.push(sim.model.calibrationState + ':' + m.slots[1].calibration + ':' + maxRate.toFixed(1)); maxRate = 0; }
  return log;
});
console.log(out.join(' | '));
await browser.close();
