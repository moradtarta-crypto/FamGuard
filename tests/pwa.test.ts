import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('PWA manifest declares an installable standalone app and a valid icon', async () => {
  const raw = await readFile(new URL('../client/public/manifest.webmanifest', import.meta.url), 'utf8');
  const manifest = JSON.parse(raw) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
  };

  assert.equal(manifest.name, 'FamGuard — Family Safety');
  assert.equal(manifest.short_name, 'FamGuard');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(
    manifest.icons?.some(
      (icon) =>
        icon.src === '/icons/famguard.svg' &&
        icon.sizes === 'any' &&
        icon.type === 'image/svg+xml' &&
        icon.purpose?.includes('maskable'),
    ),
  );
});

test('PWA service worker never caches API or cross-origin responses', async () => {
  const worker = await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8');

  assert.match(worker, /url\.origin !== self\.location\.origin\) return/);
  assert.match(worker, /url\.pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)\) return/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /caches\.match\('\/'\)/);
  assert.doesNotMatch(worker, /caches\.open\([^)]*api/i);
});

test('HTML links the PWA manifest and production entry registers its service worker', async () => {
  const html = await readFile(new URL('../client/index.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../client/main.tsx', import.meta.url), 'utf8');

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /name="theme-color"/);
  assert.match(main, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(main, /import\.meta\.env\.PROD/);
});
