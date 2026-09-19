# Tasker

Persönliches Projektmanagement-Werkzeug, selbst gehostet. Ersatz für Codecks.

- `prototype/index.html` – der klickbare Prototyp aus Phase 1. Bleibt als Referenz für Gestaltung
  und Verhalten liegen.
- `PHASE-2.md` – der Plan für die echte Anwendung: Entscheidungen, Datenmodell, API, Reihenfolge.
- `src/`, `db/` – die Anwendung selbst.

## Entwicklung

```bash
npm install
npm run dev
```

Vite läuft auf <http://localhost:5173> und reicht `/api` an den Server auf Port 3000 durch.
Beide Prozesse starten zusammen und laden bei Änderungen neu.

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm run check` | TypeScript prüfen |
| `npm test` | Tests der Berechnungslogik |
| `npm run build` | Client nach `dist/client`, Server nach `dist/server` |
| `npm start` | Produktivstart, wie Railway ihn ausführt |
| `npm run db:generate` | Migration aus dem Drizzle-Schema erzeugen |
| `npm run db:migrate` | Migrationen anwenden (passiert auch beim Serverstart) |

Für die Anmeldung braucht es lokal eine `.env`-Kopie mit `TASKER_EMAIL` und `TASKER_PASSWORD`
(siehe `.env.example`) – oder die Variablen beim Start voranstellen. Beide gelten nur, solange es
noch kein Konto gibt.

## Anmeldung

- Ein einziges Konto, angelegt beim ersten Start aus `TASKER_EMAIL` und `TASKER_PASSWORD`.
  Danach werden beide Variablen ignoriert.
- Passwort als Argon2id-Hash, Sitzung als HttpOnly-Cookie (`Secure` im Produktivbetrieb),
  90 Tage bei „angemeldet bleiben“, sonst bis zum Schließen des Browsers.
- In der Datenbank steht nur der SHA-256-Hash des Sitzungstokens, nie das Token selbst.
- Nach 10 Fehlversuchen ist die Anmeldung 15 Minuten gesperrt.
- Passwort vergessen: `TASKER_PASSWORD` neu setzen, `TASKER_PASSWORD_RESET=1` dazu, einmal
  deployen, Variable danach wieder entfernen. Alle Sitzungen werden dabei beendet.

Öffentlich erreichbar ist nur `/api/health` (für Railways Healthcheck); alles andere verlangt eine
gültige Sitzung.

## Aufbau

Ein einziger Node-Prozess liefert API und gebautes Frontend aus. Im Entwicklungsbetrieb übernimmt
Vite das Frontend, im Produktivbetrieb der Server selbst.

```
src/server/   Hono: Routen, Datenbank, später Auth und SSE
src/client/   React-App (Vite)
src/shared/   Typen, Zod-Schemas und reine Berechnungslogik für beide Seiten
db/           Drizzle-Schema und Migrationen
```

## Deployment auf Railway

Kein Dockerfile nötig – Railway erkennt das Node-Projekt und nutzt `build` und `start`.

1. Neues Railway-Projekt aus dem Repository anlegen.
2. **Volume** hinzufügen, Mount-Pfad `/data`. Ohne Volume ist die Datenbank nach jedem Deploy weg,
   weil das Dateisystem zurückgesetzt wird.
3. Variablen setzen:
   - `DATABASE_PATH=/data/tasker.db`
   - `NODE_ENV=production`
   - `TASKER_EMAIL`, `TASKER_PASSWORD` (sobald die Anmeldung steht) – gelten nur beim ersten Start,
     danach ändert man das Passwort im Profil. Railways `secret(…)`-Vorschlag als Wert ist in Ordnung;
     er wird einmal ausgewertet und bleibt dann fest.

   `PORT` setzt Railway selbst; der Server hört darauf und auf `0.0.0.0`.
4. Prüfen: `/api/health` antwortet. Der Zähler `boots` steigt bei jedem Deploy, `firstBootAt` bleibt
   gleich – genau daran erkennt man, dass das Volume greift.
