import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type Request, type Response } from 'express';
import { createApp } from './app.js';
import { FamGuardStore } from './store.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const dataFile = resolve(process.env.DATA_FILE ?? join(process.cwd(), 'data', 'famguard.json'));
const publicDir = join(import.meta.dirname, '..', 'public');
const indexHtml = join(publicDir, 'index.html');

const store = new FamGuardStore({ file: dataFile });
const app = createApp(store);

if (existsSync(indexHtml)) {
  app.use(express.static(publicDir, { maxAge: '1h', index: false }));
  app.use((req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
} else {
  console.warn(`Static dashboard not found at ${indexHtml}; run "npm run build" first.`);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`FamGuard listening on http://0.0.0.0:${port} (data: ${dataFile})`);
});
