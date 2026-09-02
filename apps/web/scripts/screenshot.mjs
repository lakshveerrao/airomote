// Usage: node scripts/screenshot.mjs <path> <out.png> [width] [height] [--setup-done] [--dev] [--sim]
//   Captures a page from the running dev server (http://127.0.0.1:5173) with Playwright and
//   prints console errors / uncaught exceptions. Flags seed localStorage so the app skips
//   first-run setup (--setup-done), enables developer mode (--dev), and connects two simulated
//   controllers before navigating (--sim).
import { chromium } from 'playwright';

// Path may be given without the leading slash (Git Bash rewrites "/x" into a Windows path): "games" → "/games", "." → "/".
const [, , rawPath = '/', out = 'shot.png', w = '1440', h = '900', ...flags] = process.argv;
const path = rawPath === '.' || rawPath.includes(':') ? '/' : rawPath.startsWith('/') ? rawPath : '/' + rawPath;
const base = process.env.AERO_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

if (flags.includes('--setup-done') || flags.includes('--dev')) {
  await page.goto(base + '/setup');
  await page.evaluate(
    ([setupDone, dev]) => {
      const key = 'aero.settings.v1';
      const cur = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}');
      cur.state = { ...cur.state, ...(setupDone ? { setupComplete: true } : {}), ...(dev ? { developerMode: true } : {}) };
      localStorage.setItem(key, JSON.stringify(cur));
    },
    [flags.includes('--setup-done'), flags.includes('--dev')],
  );
}
await page.goto(base + path, { waitUntil: 'networkidle' });
if (flags.includes('--sim')) {
  await page.evaluate(async () => {
    const a = window.__aero;
    await a.controllerManager.connect(1, 'simulator');
    await a.controllerManager.connect(2, 'simulator');
  });
  await page.waitForTimeout(2600);
}
const wait = flags.find((f) => f.startsWith('--wait='));
await page.waitForTimeout(wait ? Number(wait.split('=')[1]) : 800);
await page.screenshot({ path: out, fullPage: false });
const overflow = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log(`saved ${out} (${w}x${h}) ${overflow.scrollW > overflow.clientW ? `HORIZONTAL OVERFLOW ${overflow.scrollW}>${overflow.clientW}` : 'no h-overflow'}`);
if (errors.length) console.log(errors.join('\n'));
else console.log('no console errors');
await browser.close();
