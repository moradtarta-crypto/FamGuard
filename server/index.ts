import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { createApp, readSupabaseConfig } from './app.js';

const rawPort = process.env.PORT ?? '3000';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const publicDir = join(import.meta.dirname, '..', 'public');
const indexHtml = join(publicDir, 'index.html');

const app = createApp();

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
  console.log(`FamGuard listening on http://0.0.0.0:${port}`);
  const { config, problems } = readSupabaseConfig();
  if (config) {
    console.log(`Supabase project: ${config.supabaseUrl} (publishable key configured)`);
  } else {
    console.warn(`Supabase not configured: ${problems.join(' ')}`);
  }
});
