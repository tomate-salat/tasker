# Tasker

Persönliches Projektmanagement-Werkzeug für Solo-Entwickler, selbst gehostet.

Tasker ist bewusst für **eine Person** gebaut: ein Konto, keine Rollen, keine Zuweisungen, keine
Abstimmung im Team. Wer im Team arbeitet, ist bei [Codecks](https://www.codecks.io) besser
aufgehoben – Codecks hat Tasker in vielem inspiriert und funktioniert allein wie im Team, Tasker
dagegen nur für den eigenen Schreibtisch.

## Was Tasker kann

- **Projekte, Milestones und Aufgaben** – Aufgaben beliebig tief verschachtelt, mit Status,
  Priorität, Kategorien, Labels und Markierungen.
- **Ansichten** für den aktiven Milestone („Tisch“), Plan, Ready, Backlog, Doku, Zeitplan und
  Releases – als Liste oder als Karten.
- **Abhängigkeiten** zwischen Aufgaben und Milestones, auch über Projektgrenzen, mit Graph.
- **Beschreibungen in Markdown** mit Verweisen (`$142`), Checklisten, Bildern, Galerie und
  Zeichnungen (Excalidraw).
- **Suche** als Palette (`/` oder Strg+K), Papierkorb statt sofortigem Löschen.
- **Mehrere Tabs und Geräte** bleiben über einen Änderungs-Strom synchron.
- **MCP-Endpunkt** mit Zugangs-Tokens, damit etwa Claude Code Aufgaben lesen und anlegen kann.
- **[Godot-Plugin](https://github.com/tomate-salat/godot-tasker)** – Tasker direkt im
  Godot-Editor: Aufgaben des laufenden Milestones, Planung, Verknüpfungen mit Nodes der Szene und
  ein eigener MCP-Server, über den Claude Code aus einer Beobachtung im Spiel einen Task anlegt.
- **Import** aus dem CSV-Export von Codecks.

## Im Repository

- `prototype/index.html` – der klickbare Prototyp aus Phase 1. Bleibt als Referenz für Gestaltung
  und Verhalten liegen.
- `PHASE-2.md` – der Plan für die echte Anwendung: Entscheidungen, Datenmodell, API, Reihenfolge.
- `BROWSER-TESTS.md` – wie man die laufende Anwendung im Browser prüft, ohne die eigenen Daten
  anzufassen: Demo-Server mit Wegwerf-Datenbank und eigenem Konto.
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
| `npm test` | Tests für Server und Berechnungslogik |
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
src/server/   Hono: Routen, Datenbank, Anmeldung, Änderungs-Strom (SSE), MCP
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
   - `TASKER_EMAIL`, `TASKER_PASSWORD` – gelten nur beim ersten Start,
     danach ändert man das Passwort im Profil. Railways `secret(…)`-Vorschlag als Wert ist in Ordnung;
     er wird einmal ausgewertet und bleibt dann fest.

   `PORT` setzt Railway selbst; der Server hört darauf und auf `0.0.0.0`.
4. Prüfen: `/api/health` antwortet. Der Zähler `boots` steigt bei jedem Deploy, `firstBootAt` bleibt
   gleich – genau daran erkennt man, dass das Volume greift.

## Lizenz

[MIT](LICENSE)
