import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DATABASE_PATH, HOST, PORT, PRODUCTION, warnIfNotPersistent } from './env.js';
import { appDb, recordBoot } from './db.js';
import { dataRoutes } from './routes.js';
import { runMigrations } from './migrate.js';
import {
  SESSION_COOKIE,
  bootstrapAccount,
  changePassword,
  checkPassword,
  createSession,
  destroySession,
  getAccount,
  loginLocked,
  purgeExpiredSessions,
  sessionValid,
} from './auth.js';

warnIfNotPersistent();
runMigrations();
await bootstrapAccount();
purgeExpiredSessions();
const boot = recordBoot();

const app = new Hono();

/* ------------------------------------------------------------ Öffentliches */

// Railway prüft damit, ob der Container lebt – bewusst ohne Details.
app.get('/api/health', (c) => c.json({ ok: true, now: new Date().toISOString() }));

const loginBody = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  keepSignedIn: z.boolean().default(false),
});

app.post('/api/login', async (c) => {
  const locked = loginLocked();
  if (locked) {
    return c.json({ error: `Zu viele Versuche. Bitte in ${Math.ceil(locked / 60)} Minuten erneut.` }, 429);
  }

  const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Ungültige Anfrage.' }, 400);

  const { email, password, keepSignedIn } = parsed.data;
  if (!(await checkPassword(email, password))) {
    return c.json({ error: 'E-Mail oder Passwort stimmt nicht.' }, 401);
  }

  const session = createSession(keepSignedIn, c.req.header('user-agent'));
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: PRODUCTION,
    path: '/',
    ...(session.maxAgeSeconds ? { maxAge: session.maxAgeSeconds } : {}),
  });
  return c.json({ account: getAccount() });
});

/* ------------------------------------------------- Ab hier nur angemeldet */

app.use('/api/*', async (c, next) => {
  if (!sessionValid(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'Nicht angemeldet.' }, 401);
  }
  await next();
});

app.get('/api/me', (c) => c.json({ account: getAccount() }));

app.post('/api/logout', (c) => {
  destroySession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

const passwordBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, 'Mindestens 8 Zeichen.').max(200),
});

app.post('/api/password', async (c) => {
  const parsed = passwordBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Ungültige Anfrage.' }, 400);
  }
  if (!(await changePassword(parsed.data.current, parsed.data.next))) {
    return c.json({ error: 'Aktuelles Passwort stimmt nicht.' }, 403);
  }
  return c.json({ ok: true });
});

// Betriebsdaten – hinter der Anmeldung, weil sie den Datenbankpfad verraten.
app.get('/api/status', (c) =>
  c.json({
    database: DATABASE_PATH,
    boots: boot.boots,
    firstBootAt: boot.firstBootAt,
  }),
);

app.route('/api', dataRoutes(appDb));

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

/* ------------------------------------------------------------- Oberfläche */

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
