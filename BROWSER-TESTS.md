# Tasker im Browser prüfen

Tasker verlangt eine Anmeldung, und genau daran scheitern Prüfungen im Browser oft schon vor dem
ersten Klick. Das muss nicht sein: das Konto entsteht beim **ersten** Start einer Datenbank aus zwei
Umgebungsvariablen. Man startet also einen eigenen Server gegen eine **leere Wegwerf-Datenbank** und
gibt ihm dabei ein Demo-Konto mit – ohne die Daten des Nutzers anzufassen und ohne je ein echtes
Passwort zu brauchen.

**Nie** das echte Konto oder die echte Datenbank (`./data/tasker.db`) für Prüfungen benutzen. Nie
nach Zugangsdaten fragen – die folgenden sind frei erfunden und leben nur in `data-demo/`.

## Das Rezept

### 1. Bauen

```bash
npm run build
```

Nötig, weil der Server das Frontend nur im Produktivbetrieb selbst ausliefert
([src/server/index.ts:130](src/server/index.ts:130)). **Nach jeder Client-Änderung neu bauen und den
Server neu starten** – `dist/client/index.html` wird einmal beim Start gelesen.

### 2. Demo-Server starten

Im Hintergrund laufen lassen, damit die Sitzung weiterarbeiten kann. Mit der Bash-Shell:

```bash
NODE_ENV=production PORT=3121 HOST=127.0.0.1 DATABASE_PATH=./data-demo/tasker.db TASKER_EMAIL=demo@example.com TASKER_PASSWORD=demo-passwort-1234 TASKER_NAME=Demo node dist/server/index.js
```

In PowerShell:

```powershell
$env:NODE_ENV='production'; $env:PORT='3121'; $env:HOST='127.0.0.1'; $env:DATABASE_PATH='./data-demo/tasker.db'; $env:TASKER_EMAIL='demo@example.com'; $env:TASKER_PASSWORD='demo-passwort-1234'; $env:TASKER_NAME='Demo'; node dist/server/index.js
```

Worauf es dabei ankommt:

| Variable | Warum |
|---|---|
| `NODE_ENV=production` | Ohne das antwortet `/` mit 404 – das Frontend wird nur unter `PRODUCTION` ausgeliefert. |
| `DATABASE_PATH=./data-demo/tasker.db` | Eine eigene Datenbank. Ohne das läuft die Prüfung auf den echten Daten des Nutzers. |
| `TASKER_EMAIL` / `TASKER_PASSWORD` | Legen das Konto an – **nur** wenn die Datenbank noch keines hat ([auth.ts:43](src/server/auth.ts:43)). Liegt `data-demo/` schon, werden sie stillschweigend ignoriert; dann vorher löschen. |
| `PORT=3121` | Irgendein freier Port abseits von 3000 und 5173, damit ein laufendes `npm run dev` des Nutzers ungestört bleibt. |
| `HOST=127.0.0.1` | Vorgabe wäre `0.0.0.0`; für eine Prüfung reicht die eigene Maschine. |

Die Warnung „DATABASE_PATH ist relativ“ beim Start ist hier richtig und ohne Belang – sie gilt dem
Railway-Betrieb. Steht am Ende „Konto angelegt für demo@example.com“, hat es geklappt.

### 3. Anmelden

Im eingebauten Browser `http://127.0.0.1:3121` öffnen, dann über die Felder:

```
E-Mail:   demo@example.com
Passwort: demo-passwort-1234
```

Das Sitzungs-Cookie ist unter `NODE_ENV=production` `Secure`, aber `127.0.0.1` und `localhost`
gelten dem Browser als sicherer Kontext – die Anmeldung geht also über `http` durch.

Verlässlich ist der Weg über `read_page` (liefert `ref_N` für die Felder), dann `form_input` je Feld
und `computer`-Klick auf „Anmelden“. Nach dem Klick zeigt die Seite kurz „Moment …“; einmal
`get_page_text` nachfassen.

### 4. Daten anlegen

Klicken geht, über die API geht es schneller. Die Anmeldung liefert ein Cookie, das `curl` in einer
Datei behalten kann:

```bash
curl -s -c jar.txt -X POST http://127.0.0.1:3121/api/login -H 'Content-Type: application/json' -d '{"email":"demo@example.com","password":"demo-passwort-1234","keepSignedIn":true}'
```

Danach mit `-b jar.txt` weiterarbeiten. Angelegt wird über **`POST /api/kind/:kind`** – `project`,
`task`, `milestone`, `category`, `mark`, `group`. Es gibt keine deutschsprachigen Routen dafür.

```bash
curl -s -b jar.txt -X POST http://127.0.0.1:3121/api/kind/project -H 'Content-Type: application/json' -d '{"name":"Demo"}'
curl -s -b jar.txt -X POST http://127.0.0.1:3121/api/kind/task -H 'Content-Type: application/json' -d '{"projectId":"<id>","title":"Erste Aufgabe"}'
```

Geändert wird mit `PATCH /api/kind/:kind/:id`. Die Hülle ist **`{version, changes}`** – beides
zusammen, sonst 400, und eine falsche `version` gibt 409
([shared/api.ts:97](src/shared/api.ts:97)):

```bash
curl -s -b jar.txt -X PATCH http://127.0.0.1:3121/api/kind/task/<id> -H 'Content-Type: application/json' -d '{"version":1,"changes":{"status":"blocked"}}'
```

Den Stand einer Ansicht liest man am einfachsten aus `GET /api/bootstrap` – einzelne Objekte über
`GET /api/kind/...` gibt es nicht.

**Achtung:** Wer den Bestand hinter dem Rücken des Browsers ändert, muss die Seite neu laden, bevor
er urteilt.

### 5. Aufräumen – gehört dazu

Server beenden und die Wegwerf-Datenbank löschen, sonst liegt sie beim nächsten Mal noch da und das
Konto wird nicht mehr neu angelegt:

```bash
rm -rf data-demo
```

Der Ordner ist in `.gitignore`, darf aber trotzdem nicht liegen bleiben.

## Prüfen, was man sieht

- Screenshots laufen im eingebauten Browser gern in Timeouts. Belastbar sind `get_page_text`,
  `find`, `read_page` und `javascript_tool`; ein Screenshot ist nur nötig, wenn danach nach
  Koordinaten geklickt wird (etwa für einen Rechtsklick).
- Tastatur-Verhalten (Leertaste, Pfeile, `Alt`+Pfeil) prüft man mit `computer`-`key`, nachdem eine
  Zeile ausgewählt ist. Das Ergebnis liest man an den CSS-Klassen ab, z.B. `st-open`, `st-progress`,
  `st-done` – dafür ist `javascript_tool` mit `document.querySelector(...).className` das kürzeste
  Werkzeug.
- Ein Teil des Zustands liegt im Browser, nicht auf dem Server: `tasker.collapsed` (Klappzustand),
  `tasker.scope`, `tasker.side`, `tasker.layouts`, `tasker.archOpen` in `localStorage`
  ([store.ts:323](src/client/store.ts:323)). Um eine Vorgabe zu prüfen, diese Schlüssel vorher
  löschen; um Dauerhaftigkeit zu prüfen, neu laden und nachsehen.

## Die Vite-Variante

`npm run dev` ist bequemer (lädt bei Änderungen neu), aber der Vite-Proxy zeigt fest auf Port 3000
([vite.config.ts:26](vite.config.ts:26)). Der Demo-Server müsste also auf 3000 laufen und würde mit
einem laufenden `npm run dev` des Nutzers kollidieren. Für eine Prüfung zwischendurch ist der
gebaute Server auf einem eigenen Port der ruhigere Weg.
