# Tasker – Phase 2: Echte Anwendung

Phase 1 (klickbarer Prototyp, `prototype/index.html`) ist abgeschlossen. Dieses Dokument hält fest,
was der Prototyp entschieden hat und wie daraus eine deploybare Anwendung wird.

---

## 1. Was der Prototyp entschieden hat

Diese Fragen waren in Phase 1 offen und sind jetzt beantwortet:

| Frage | Entscheidung |
|---|---|
| Hierarchie-Modell A oder B? | **A** – ein Typ, beliebig tief. Ein Task mit Kindern ist automatisch eine Sammel-Aufgabe. |
| Milestone als Task oder eigenes Objekt? | **Eigenes Objekt.** Dazu Gruppen als leichte Zwischenebene im Backlog. |
| Backlog eigener Bereich oder Filter? | **Eigener Bereich.** |
| Projekt = Task der obersten Ebene? | **Nein**, Projekt bleibt ein eigenes Objekt mit Farbe und Kategorien. |
| Schätzung in Punkten? | **Verworfen.** Gezählt werden Aufgaben, nicht Punkte (`countTasks`). Tempo = Aufgaben pro Woche. |
| Wie viel Information pro Zeile? | **Tabellen-Layout** mit festen Spalten links (Markierung, Priorität), dann der eingerückte Baum. |

Weitere im Prototyp gewachsene Festlegungen, die ins Produkt übernommen werden:

- **Status:** Fortschrittskette `offen → progress → done` plus die Sonderstatus `unclear` und `blocked`.
  Immer genau einer aktiv, in der Oberfläche als zwei getrennte Button-Gruppen.
- **Vererbung:** Kategorien wirken **nach unten** (ein Kind ohne eigene Kategorie erbt die des Elternteils),
  Labels wirken **nach oben** (ein Elternteil zeigt zusätzlich die Labels seiner Unteraufgaben).
  Beides ist abgeleitet, nichts davon wird gespeichert.
- **Abhängigkeiten** gibt es für Tasks und für Milestones, mit identischer Bedienung, und sie dürfen
  Projektgrenzen überschreiten.
- **Markierungen** (Emoji + Name) sind projektübergreifend und erzeugen im Backlog je eine Sammelgruppe.
- **Dokumente** sind technisch normale Tasks in einer eigenen Ansicht; ihr Inspektor ist bewusst anders.
- **Papierkorb** mit Ablauffrist statt sofortigem Löschen.
- **Zeichnungen** gehören zu einem Task und werden über `![[zeichnung:Name]]` in die Beschreibung eingebettet.

---

## 2. Technologie

Entschieden:

- **Backend:** TypeScript, **Hono** auf Node. Ein einziger Prozess, der API, SSE-Stream und die
  gebauten Frontend-Dateien ausliefert.
- **Datenbank:** **SQLite** über `better-sqlite3`, Zugriff mit **Drizzle ORM** (typisiertes SQL plus
  echte Migrationsdateien).
- **Frontend:** TypeScript, **Vite**, **React**. Der komplette Datenbestand liegt in einem Store
  (**Zustand**) im Speicher – dasselbe Modell wie `S` im Prototyp.
- **Validierung:** **Zod**, einmal definiert und auf Server und Client benutzt.
- **Deployment:** **Railway ohne Dockerfile.** Railway baut das Node-Projekt selbst; nötig sind nur
  `build` und `start` in der `package.json`, Binden an `process.env.PORT` und `0.0.0.0`, sowie ein
  **Volume** für die SQLite-Datei (`DATABASE_PATH`, z.B. `/data/tasker.db`), weil das Dateisystem
  sonst bei jedem Deploy zurückgesetzt wird.

Bewusst nicht genommen: Next.js (kein SSR nötig, verkompliziert Railway), Prisma (zu schwer),
TanStack Query (der Datenbestand passt in den Speicher), Tailwind (das CSS existiert bereits).

Warum SQLite reicht: Bei einem Nutzer ist die Zeilenzahl kein Thema – 100.000 Tasks sind grob 50 MB.
Der Engpass wäre das Frontend, nicht die Datenbank. Umzugsgründe nach Postgres wären mehrere
gleichzeitig schreibende Personen oder mehrere App-Instanzen, nicht die Datenmenge. Damit ein späterer
Umzug billig bleibt: normale Spalten und Fremdschlüssel, keine SQLite-Sonderwege.

### Ordnerstruktur

```
src/server/    Hono: Routen, SSE, Auth, Persistenz
src/client/    React-App (Vite)
src/shared/    Zod-Schemas, Typen, reine Berechnungslogik
db/            Drizzle-Schema und Migrationen
prototype/     bleibt als Referenz liegen
```

`src/shared` ist der Grund für ein einziges Repository: Typen und Berechnungen existieren genau einmal.

---

## 3. Datenmodell

Ableitung aus dem Prototyp-State. Gemeinsam für alle Tabellen: `id` als Text-Primärschlüssel,
`created_at`, `updated_at`, `version` (Integer, für die Konflikterkennung, siehe Abschnitt 5).

**project** – `name`, `color`, `order`
**category** – `project_id`, `name`, `order` (im Prototyp als `p.categories` eingebettet, hier eigene Tabelle)
**mark** – `emoji`, `name` (projektübergreifend)
**milestone** – `project_id`, `title`, `desc`, `planned`, `order`, `qorder`, `collapsed`,
`status`, `start_date`, `end_date`, `end_auto`, `archived_at`
**group** – `project_id`, `title`, `order`, `collapsed`
**task** – `project_id`, `parent_id`, `milestone_id`, `group_id`, `doc` (Flag statt Pseudo-Container),
`title`, `desc`, `prio`, `status`, `done_at`, `order`, `cat_id`, `mark_id`, `archived_at`,
`hidden_by` (archivierter Vorfahre, siehe Abschnitt 4)
**task_tag** – `task_id`, `tag` (im Prototyp ein Array, hier eine Zuordnungstabelle)
**dependency** – `from_id`, `to_id`, `kind` (`task` oder `milestone`); deckt beide Objekttypen ab
**drawing** – `task_id`, `name`, `order`, `shapes` (JSON – hier ist JSON angemessen, die Formen werden nie einzeln abgefragt)
**milestone_log** – `milestone_id`, `day`, `scope`, `done` (das `m.log` für den Burnup)
**trash** – `kind`, `payload` (JSON der gelöschten Objekte), `title`, `project_id`, `deleted_at`
**setting** – Einzelnutzer-Einstellungen: Theme, Tempo, zuletzt gewähltes Projekt, Ansichtszustände

Nicht gespeichert, sondern zur Laufzeit berechnet (wandert unverändert nach `src/shared`):
`total`, `doneP`, `progressPct`, `msStats`, `schedule()`, `effCat`, `effTags`, `inheritedBlock`,
`dependsOn`, `desc()`, `kids()`, die Checklisten-Parser und `statusSegs`.

Der reine UI-Zustand des Prototyps (`S.ui.sel`, `detail`, `editing`, `contentEdit`, Filter) gehört
**nicht** in die Datenbank, sondern in den Client-Store; nur die dauerhaften Teile (Theme, Tempo,
Klappzustände, zuletzt gewähltes Projekt) gehen nach `setting`.

### Entschiedene Detailfragen

- **`order` serverseitig, `collapsed` pro Gerät.** Die Sortierung ist Inhalt und steht in der
  Datenbank (Spalte `sort_order`); ob eine Zeile gerade zugeklappt ist, bleibt im Client.
- **Dokumente als Flag `doc` am Task**, statt des Pseudo-Containers aus dem Prototyp.
- **Kein `done`-Feld.** Im Prototyp war es immer `status === 'done'` und damit eine zweite Wahrheit,
  die auseinanderlaufen kann. Es bleibt nur `status` und `done_at`.
- **Abhängigkeiten ohne Fremdschlüssel**, weil `from_id`/`to_id` je nach `kind` auf Tasks oder
  Milestones zeigen. Verwaiste Einträge räumt der Server auf, wie `pruneCrossDeps()` im Prototyp.

---

## 4. API

REST über `/api`, JSON, Zod-validiert. Keine GraphQL-Schicht – der Datenbestand ist klein und die
Zugriffsmuster sind bekannt.

- `GET /api/bootstrap` – der **aktive** Datenbestand in einem Rutsch. Der Client hält ihn im
  Speicher, genau wie der Prototyp `S`. Das Archiv ist ausdrücklich nicht dabei (siehe unten).
- `GET /api/archive` – das Archiv, seitenweise, mit Suche und Projektfilter. Wird erst geladen,
  wenn die Archivansicht geöffnet wird.
- `POST /api/:kind` – anlegen
- `PATCH /api/:kind/:id` – ändern, mit `version` des Standes, auf dem die Änderung basiert
- `DELETE /api/:kind/:id` – in den Papierkorb
- `POST /api/move` – Drag & Drop: neuer Elternteil / Milestone / Gruppe plus neue Reihenfolge, als eine Transaktion
- `POST /api/bulk` – Mehrfachauswahl als eine Transaktion
- `GET /api/events` – **SSE-Stream** mit jeder Änderung
- `POST /api/import` – Prototyp-Export oder Codecks-Export einlesen
- `GET /api/export` – der gesamte Bestand als JSON

Jede schreibende Route läuft in einer SQLite-Transaktion und schickt danach das geänderte Objekt in den
SSE-Stream.

### Das Archiv bleibt draußen

Archiviert wird ständig, gelöscht wird nie – das Archiv wächst also monoton. Käme es bei jedem
Laden mit, würde die Startzeit mit den Jahren immer schlechter, ohne dass sich an der täglichen
Arbeit etwas ändert (grob 400 Byte je Aufgabe, bei 10.000 archivierten also mehrere Megabyte pro
Seitenaufruf, die auch noch geparst und indexiert werden müssen). Es ist ohnehin eine eigene
Ansicht und kein Teil des Arbeitsflusses.

Zwei Dinge sind dabei zu beachten, weil der Prototyp das Archiv nur als Ansicht trennt, nicht als
Daten:

1. **Der Archiv-Status wird nach unten vererbt.** `archive()` setzt das Datum im Prototyp nur am
   angeklickten Eintrag; Unteraufgaben behalten `archived_at = NULL` und verschwinden nur, weil die
   Anzeige die Elternkette prüft. Dasselbe gilt für die Wurzelaufgaben eines archivierten
   Milestones. Ein einfaches `WHERE archived_at IS NULL` würde sie also fälschlich ausliefern.

   **Lösung: eine zweite, gepflegte Spalte `hidden_by`** (die ID des archivierten Vorfahren),
   gesetzt auf dem ganzen Teilbaum. Damit ist die Abfrage im heißen Pfad ein indizierter Filter
   statt einer rekursiven Abfrage:

   ```sql
   SELECT * FROM task WHERE hidden_by IS NULL AND archived_at IS NULL
   ```

   `archived_at` bleibt dem explizit archivierten Eintrag vorbehalten – sonst würde ein archivierter
   Milestone mit 40 Aufgaben im Archiv als 41 gleichrangige Einträge erscheinen statt als einer mit
   aufklappbarem Baum, und die Unterscheidung „einzeln archiviert“ gegenüber „mitgegangen“ ginge
   verloren.

   Regeln für `hidden_by`:
   - **Archivieren:** auf dem Teilbaum setzen, aber nur dort, wo es noch leer ist – ein zuvor für
     sich archiviertes Kind behält seinen eigenen Bezug.
   - **Wiederherstellen:** `UPDATE task SET hidden_by = NULL WHERE hidden_by = :id`. Kinder mit
     eigenem `archived_at` bleiben korrekt versteckt.
   - **Verschieben:** beim Ziehen in einen archivierten Ast hinein oder heraus muss `hidden_by` für
     den Teilbaum nachgezogen werden. Das ist die einzige Stelle, an der der abgeleitete Wert kippen
     kann, deshalb gehört sie in genau eine Funktion und wird getestet.

   Rekursiv gerechnet wird damit weiterhin, aber einmal beim Archivieren statt bei jedem Laden.
2. **Abhängigkeiten dürfen ins Archiv zeigen.** Fürs Blockieren ist das folgenlos, weil archivierte
   Aufgaben nicht blockieren. Damit der Inspektor den Titel trotzdem anzeigen kann, schickt
   `bootstrap` zu solchen Verweisen einen Platzhalter mit (ID, Titel, archiviert ja/nein), statt das
   Archiv nachzuladen.

Nicht betroffen: der Burnup zieht seine Zahlen aus `milestone_log`, und Zähler wie Filter rechnen
ohnehin nur mit Aktivem. Die Suche im Archiv läuft serverseitig als indizierte Abfrage.

---

## 5. Mehrere Tabs und Geräte

Der Prototyp geht davon aus, dass er allein auf den Daten sitzt. Sobald das Tool auf einem Server läuft,
sind zwei Tabs oder Handy plus Rechner der Normalfall. Zwei Mechanismen, von Anfang an eingebaut:

1. **SSE-Push.** Nach jeder Änderung schickt der Server das geänderte Objekt an alle offenen Clients;
   der Store übernimmt es und rendert neu. Deckt auch andere Geräte ab – im Gegensatz zu `BroadcastChannel`,
   das nur Tabs desselben Browsers erreicht und deshalb bewusst nicht benutzt wird.
2. **Versionsprüfung.** Jeder `PATCH` schickt die `version` mit, auf der er basiert. Stimmt sie nicht,
   lehnt der Server mit `409` ab und der Client lädt den Datensatz neu. Damit kann kein stiller
   Datenverlust entstehen, auch wenn ein Push einmal nicht ankommt.

Der **Undo-Stack** lebt weiterhin im Client, wird aber pro Tab geführt und beim Zurücknehmen gegen die
`version` geprüft; eine Rücknahme, die auf einem überholten Stand basiert, wird abgelehnt statt blind
ausgeführt.

---

## 6. Nutzerverwaltung

Der Prototyp hat Login-Screen und Profil-Dialog bereits gestaltet (E-Mail, Passwort, „angemeldet
bleiben“, Avatar, Name, Theme, Tempo, Abmelden), aber ohne Funktion: jedes Passwort wird akzeptiert.
Die Gestaltung bleibt, die Funktion kommt dazu.

### Entscheidung: ein einziger Nutzer, dauerhaft

**Kein `user_id` in den Tabellen**, keine Rechteprüfung, keine Registrierung. Das Konto steht in der
`setting`-Tabelle. Begründung: Der Aufwand einer vorsorglichen `user_id` liegt nicht in der
Abfragezeit – die ist bei diesen Datenmengen nicht messbar – sondern darin, dass jede Abfrage und
jedes Einfügen sie mitschleppen muss und ein vergessener Filter bei einem Nutzer niemals auffällt.
Der schwierige Teil an mehreren Personen sind ohnehin Freigaben, Rechte und Zuweisungen, und die
lassen sich nicht halb vorbauen. Nachrüsten wäre in SQLite ein
`ALTER TABLE ... ADD COLUMN user_id TEXT NOT NULL DEFAULT 'me'` plus Index – bei diesem Bestand eine
Migration von Sekunden.

### Anmeldung: E-Mail und Passwort, selbst verwaltet

- Das Konto wird **beim ersten Start** aus `TASKER_EMAIL` und `TASKER_PASSWORD` angelegt. Keine
  Registrierung, kein zweites Konto. Existiert das Konto bereits, werden beide Variablen **ignoriert** –
  sonst würde ein im Profil geändertes Passwort beim nächsten Deploy wieder überschrieben.
- Passwort als **Argon2id-Hash** in der Datenbank, nie im Klartext, nie im Log.
- Session als **HttpOnly-Cookie** mit `Secure` und `SameSite=Lax`. Laufzeit abhängig von „angemeldet
  bleiben“: reine Sitzung oder 90 Tage. Die Session-IDs liegen in einer Tabelle `session`, damit
  „Abmelden“ tatsächlich abmeldet und nicht nur das Cookie löscht.
- **Passwort ändern** im Profil-Dialog, an der Stelle, an der jetzt der Hinweis steht, dass es im
  Prototyp keins gibt.
- **Passwort vergessen:** `TASKER_PASSWORD` auf das neue Passwort setzen, zusätzlich
  `TASKER_PASSWORD_RESET=1`, einmal neu deployen. Der Server setzt das Passwort dann einmalig neu,
  verwirft alle offenen Sessions und schreibt in die Logs, dass die Variable wieder entfernt werden
  soll. Ohne Mailversand gibt es keinen besseren Weg, und für ein Ein-Personen-Tool genügt er.
- **Rate-Limit** auf der Login-Route, weil die Instanz öffentlich erreichbar ist.
- Alle `/api`-Routen außer Login liegen hinter einer Session-Prüfung; der SSE-Stream ebenso.

Zusätzliche Tabelle: **session** – `id`, `created_at`, `expires_at`, `last_seen_at`.
Das Konto selbst (E-Mail, Name, Avatar, Passwort-Hash) lebt in `setting`.

---

## 7. Reihenfolge der Umsetzung

1. ~~Projektgerüst: `package.json` mit `build`/`start`, Vite, TypeScript, Hono, Drizzle. Eine leere Seite,
   die auf Railway deployt – der Deploy-Weg wird als Erstes bewiesen, nicht als Letztes.~~
   **Erledigt lokal**, siehe `README.md`. Offen ist nur noch das Anlegen des Railway-Projekts samt Volume.
2. ~~Drizzle-Schema und erste Migration, Volume auf Railway einhängen.~~ **Erledigt**
   (`db/schema.ts`, `db/migrations/0000_*.sql`; die Migrationen laufen beim Serverstart mit).
3. ~~Anmeldung: Konto aus Umgebungsvariablen, Argon2id, Session-Cookie, Login-Screen des Prototyps
   anschließen. Früh, weil die Instanz von Anfang an öffentlich erreichbar ist.~~ **Erledigt**
   (`src/server/auth.ts`, `src/client/Login.tsx`).
4. ~~Reine Logik aus dem Prototyp nach `src/shared` übernehmen, mit Tests – das ist der Teil, der
   unverändert bleibt und sich gut prüfen lässt.~~ **Erledigt** (`src/shared/`, 122 Tests, davon 70
   im direkten Abgleich mit den Werten, die der Prototyp für seine Beispieldaten selbst ausrechnet).
5. ~~API mit `bootstrap` (ohne Archiv), Anlegen/Ändern/Löschen, Transaktionen, Versionsprüfung.~~
   **Erledigt** (`src/server/repo.ts`, `src/server/routes.ts`, `src/shared/api.ts`). Noch offen aus
   der API-Liste: `/api/bulk` und `/api/events` (kommen mit Schritt 9), Import und Export.
6. Client-Grundgerüst: Store, Bootstrap-Laden, Tabellenansicht mit Baum, Auswahl, Inspektor.
7. Die restlichen Ansichten: Backlog, Dokumente, Milestone-Planung, Papierkorb sowie das Archiv,
   das seine Daten erst beim Öffnen nachlädt.
8. Drag & Drop, Tastaturbedienung, Schnell-Erfassung, Zeichen-Editor.
9. SSE-Push und Konfliktbehandlung.
10. Import: erst der Prototyp-Export (damit die eigenen Daten mitkommen), dann Codecks.
11. Gamification, dezent.

---

## 8. Verifikation

- Nach Schritt 1 muss ein Railway-Deploy grün sein und die Seite öffentlich erreichbar; das ist die
  Voraussetzung für alles Weitere.
- Nach Schritt 2: ein Deploy darf die Daten im Volume nicht verlieren – einmal Daten anlegen, neu
  deployen, prüfen.
- Nach Schritt 3: ohne gültige Session liefert jede `/api`-Route und der SSE-Stream `401`, und ein
  falsches Passwort läuft ins Rate-Limit.
- Die reine Logik aus `src/shared` bekommt Unit-Tests; das Verhalten muss dem Prototyp entsprechen
  (Fortschritt, Zeitplan, Vererbung, blockierte Aufgaben).
- Zwei Tabs gleichzeitig öffnen: Änderung in Tab A erscheint in Tab B, und eine Änderung auf
  veraltetem Stand wird abgelehnt statt überschrieben.
- Mobile Breite prüfen.
- Der eigene Datenbestand aus dem Prototyp lässt sich importieren und sieht danach gleich aus.
