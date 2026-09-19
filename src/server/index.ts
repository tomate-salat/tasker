import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { DATABASE_PATH, HOST, PORT, PRODUCTION } from './env.js';
import { recordBoot } from './db.js';
import { runMigrations } from './migrate.js';

runMigrations();
const boot = recordBoot();
const app = new Hono();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    now: new Date().toISOString(),
    database: DATABASE_PATH,
    boots: boot.boots,
    firstBootAt: boot.firstBootAt,
  }),
);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Im Produktivbetrieb liefert dieser Server auch das gebaute Frontend aus –
// ein einziger Railway-Service statt zweier. In der Entwicklung macht das Vite.
if (PRODUCTION) {
  const indexHtml = readFileSync('dist/client/index.html', 'utf8');
  app.use('/*', serveStatic({ root: './dist/client' }));
  app.get('/*', (c) => c.html(indexHtml)); // SPA-Fallback
}

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Tasker läuft auf http://${HOST}:${info.port} (Datenbank: ${DATABASE_PATH})`);
});
