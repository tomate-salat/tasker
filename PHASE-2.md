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
- **Labels je Projekt:** Beim Vergeben (Inspektor, Zellmenü, Mehrfachauswahl) werden nur die Labels
  vorgeschlagen, die im Projekt der Aufgabe schon vorkommen (`projectTags`) – Wunsch des Nutzers.
- **Abhängigkeiten** gibt es für Tasks und für Milestones, mit identischer Bedienung, und sie dürfen
  Projektgrenzen überschreiten. Ein Task darf zusätzlich auf einen ganzen **Milestone** warten
  (erledigt heißt: Status „erledigt“ oder alle seine Aufgaben erledigt, `milestoneDone`); die
  Gegenrichtung gibt es bewusst nicht. Im Prototyp fehlt das – Wunsch des Nutzers, Grundlage für
  „In Milestone umwandeln“. Setzen lassen sie sich auch per Ziehen: über einer gezogenen Zeile
  zeigt der Bereich „Abhängigkeiten“ im Inspektor zwei Felder, eines je Richtung. Damit man dabei
  die Ansicht wechseln kann, **bleibt die Auswahl beim Reiterwechsel stehen** (auch das ein Wunsch
  des Nutzers; im Prototyp schloss sich der Inspektor).
- **In Milestone umwandeln:** Ein Task mit Unteraufgaben wird zum vorbereiteten Milestone
  (`POST /api/convert`). Er übernimmt Titel, Beschreibung und Verweis-Nummer, die Unteraufgaben
  werden seine Wurzelaufgaben, der Task wandert in den Papierkorb. Was der Milestone nicht kennt,
  wird vorher weitergereicht: Kategorie an Unteraufgaben ohne eigene, Labels dazu, eigene Blocker
  an alle Unteraufgaben (sie hatten sie ohnehin geerbt). Wer auf den Task gewartet hat, wartet
  danach auf den Milestone. Priorität, Markierung und Status fallen weg.
- **Markierungen** (Emoji + Name) sind projektübergreifend und erzeugen im Backlog je eine Sammelgruppe.
- **Dokumente** sind technisch normale Tasks in einer eigenen Ansicht; ihr Inspektor ist bewusst anders.
- **Papierkorb** mit Ablauffrist statt sofortigem Löschen.
- **Zeichnungen** gehören zu einem Task und werden über `![[zeichnung:Name]]` in die Beschreibung eingebettet.
- **Kartenansicht (Versuch):** Neben der Liste können Plan, Ready, Backlog und Doku als Karten
  erscheinen, angelehnt an Codecks – der Umschalter „Liste/Karten“ in der Reiterleiste gilt je
  Ansicht und wird pro Gerät gemerkt (`tasker.layouts`). Vorgabe: Plan und Ready als Karten,
  Backlog und Doku als Liste. Doku-Karten zeigen wie ihr Inspektor weder Status noch Priorität noch
  Fortschritt, statt des Zählers die Zahl der Unterseiten; das Feld „Titelbild“ steht dort für sich.
  Karten gibt es nur für Aufgaben ohne Elternteil, mit Titelbild, Status, Priorität,
  Markierung (als Leiste über dem Titel mit Emoji und Namen, gestaltet wie der Fuß) und Fortschrittssegmenten. Das Titelbild wird ausdrücklich gesetzt (`coverImageId` am
  Task; Bilder in der Beschreibung zählen nicht): über das Feld „Titelbild“ rechts neben dem Status im Inspektor (ohne Vorschau –
  die zeigt die Karte; ohne Bild ein Ablagefeld für Ziehen aus Galerie oder vom Rechner, Strg+V und
  Klick für den Dateidialog, mit Bild nur „Entfernen“), durch Ziehen auf die Karte oder mit Strg+V auf der ausgewählten Karte. Was vom Rechner kommt, landet in der
  Galerie im Ordner „Cardimages“ des Projekts (wird bei Bedarf angelegt). Endgültig gelöschte Bilder
  leeren das Feld. Ist ein Titelbild gesetzt, liegt es dezent hinter dem Inspektor (oben bündig,
  auf Breite gebracht, bei 8 % Deckkraft, unten weich ausgeblendet). Unteraufgaben erben das Titelbild der nächsten Aufgabe darüber, die eins hat; ein eigenes überschreibt es.
  Darüber gibt es Vorgaben, die ganze Kette lautet Projekt → Kategorie → Markierung → Task →
  Unteraufgabe → …: das spezifischste gesetzte Bild gilt, das Projekt ist die letzte Vorgabe;
  Markierung und Kategorie zählen auch geerbt (`effectiveCover`). Die Vorgaben (`coverImageId` an
  Projekt, Kategorie und Markierung, Migration `0011_titelbild_vorgaben`) setzt man in den
  Dialogen „Kategorien“ (oben auch das Projekt, im Projektmenü „Kategorien &
  Titelbild …“) und „Markierungen“ – Klick, Datei daraufziehen oder Strg+V – oder aus der Galerie über deren
  Kontextmenü („Als Titelbild für Projekt/Kategorie/Markierung“, je mit allen zur Auswahl – bei
  einem gewählten Projekt nur dessen Kategorien). Bilder einer Markierung landen im zuletzt
  offenen Projekt. Die Galerie zählt die Vorgaben als Verwendung.
  **Ein Inspektor für Liste und Karten:** Titelbild im Hintergrund, Feld „Titelbild“ und der Baum
  gelten in jeder Ansicht – auch wo die Liste keine Titelbilder zeigt. Den Baum zeigt
  der Inspektor an seinem Ende, sobald die Wurzel Unteraufgaben hat (sonst wie bisher die Liste der
  Unteraufgaben), klebend am unteren Rand und als Ganzes einklappbar (standardmäßig
  offen), immer ab der Wurzel – auch wenn eine Unteraufgabe ausgewählt ist –, mit Auswahl, Ziehen und
  Kontextmenü wie in der Liste. Die Wurzel selbst ist dort nicht einklappbar. Nicht im Prototyp, Wunsch des Nutzers; ob sie
  bleibt, ist offen. Deshalb steckt fast alles in `ui/Cards.tsx` und `ui/cards.css`, die übrigen
  Stellen sind als „Karten“ kommentiert; die Liste selbst bleibt unverändert.

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
  Datenbank (Spalte `sort_order`); ob eine Zeile gerade zugeklappt ist, bleibt im Client. Steht
  dort nichts, gilt eine Vorgabe (`isCollapsed` in `outline.ts`): Gruppen ohne Aufgaben sind zu –
  auch „Unsortiert“ und die smarten –, damit die Ansicht nicht aus lauter leeren Behältern
  besteht (Wunsch des Nutzers). Wer eine leere Gruppe aufklappt, dem bleibt sie offen.
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
- `POST /api/kind/:kind` – anlegen
- `PATCH /api/kind/:kind/:id` – ändern, mit `version` des Standes, auf dem die Änderung basiert
- `DELETE /api/kind/:kind/:id` – in den Papierkorb
- `POST /api/kind/:kind/:id/archive` bzw. `/restore` – archivieren und zurückholen
- `POST /api/move` – Drag & Drop: neuer Elternteil / Milestone / Gruppe plus Platz (`index`), als eine Transaktion
- `GET|POST /api/drawings`, `PATCH|DELETE /api/drawings/:id` – Zeichnungen (siehe Abschnitt 7, Schritt 8)
- `GET /api/bilder` – der Bestand für die Galerie: Angaben und Verwendungen, nie die Bytes
- `GET /api/bilder/:id` (`?v=klein`) – die Bytes, dauerhaft zwischenspeicherbar
- `POST /api/bilder` – ein fertiges Bild hochladen (`FormData`, kein JSON)
- `POST /api/bilder/:id/loeschen` bzw. `/zurueck` – in den Papierkorb und zurück
- `POST|PATCH|DELETE /api/bildordner[/:id]` – Ordner der Galerie anlegen, umbenennen, umhängen, löschen
  (ohne Zusatz aufgelöst, mit `?inhalt=weg` samt Inhalt in den Papierkorb)
- `POST /api/bildordner/einsortieren` – Bilder in einen Ordner legen (`folderId: null` heißt ganz oben)

Die Objektrouten liegen bewusst unter dem Präfix `/kind`, damit sie sich mit festen Pfaden wie
`/move`, `/trash` oder `/settings` nicht überschneiden können. Sonst hinge die Korrektheit an der
Reihenfolge, in der die Routen registriert werden, und kippte beim nächsten eingefügten Endpunkt.
- `POST /api/bulk` – Mehrfachauswahl als eine Transaktion
- `POST /api/duplicate` – eine Aufgabe samt Unterbaum, Labels und Abhängigkeiten kopieren
- `POST /api/convert` – aus einem Task mit Unteraufgaben einen vorbereiteten Milestone machen;
  gibt den neuen Milestone und die Gegen-Schritte zurück
- `POST /api/steps` – mehrere kleine Schritte als eine Transaktion. Das braucht „Erledigte
  archivieren“ (Milestones und Aufgaben gemischt) und die Rücknahme: jede schreibende Route liefert
  die Gegen-Schritte mit, der Client schickt sie hierher zurück.
- `GET /api/events` – **SSE-Stream** mit jeder Änderung (siehe Abschnitt 7, Schritt 9)
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
ausgeführt. Umgesetzt über `POST /api/steps`: jede schreibende Handlung liefert ihre Gegen-Schritte
mit, der Stapel hält sie, und „Rückgängig“ schickt sie in einer Transaktion zurück.

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
6. ~~Client-Grundgerüst: Store, Bootstrap-Laden, Tabellenansicht mit Baum, Auswahl, Inspektor.
   Dazu das Anlegen von Projekt, Milestone und Gruppe – ohne das ist eine frische Instanz leer und
   bleibt es auch.~~
   **Erledigt** (`src/client/store.ts`, `src/client/ui/`). Geschrieben wird vorerst ohne Vorgriff:
   erst die Antwort des Servers, dann der neue Zustand. Optimistische Änderungen kommen mit
   Schritt 9, zusammen mit dem Änderungs-Push.
7. ~~Die restlichen Ansichten: Backlog, Dokumente, Milestone-Planung, Papierkorb sowie das Archiv,
   das seine Daten erst beim Öffnen nachlädt.~~ **Erledigt** (`src/client/ui/views.tsx`).
   Dazu kamen serverseitig `/api/trash` (auflisten, wiederherstellen, endgültig löschen) und
   `/api/settings` (Tempo, Theme). Noch offen in diesen Ansichten: Markierungs-Sammelgruppen im
   Backlog, der Burnup im Milestone und der eigene Inspektor für Dokumente.
8. ~~Drag & Drop, Tastaturbedienung, Schnell-Erfassung, Zeichen-Editor.~~ **Erledigt.**
   - **Schnell-Erfassung** als reine Funktion in `src/shared/quickadd.ts` (`Titel #label !1 >Ziel
     +Projekt ~status %Markierung &Kategorie @nach:Aufgabe`), mit Vorschau beim Tippen. Weil eine
     Zeile schon eine fertige Aufgabe ergibt, nimmt `POST /api/kind/task` jetzt dieselben Felder
     entgegen wie `PATCH`.
   - **Eine Zeilenfolge für alles:** `src/shared/outline.ts` berechnet die sichtbaren Zeilen einer
     Ansicht. Anzeige, Tastatur und Drag & Drop benutzen dieselbe Liste, sonst laufen Pfeiltasten
     und Bildschirm auseinander.
   - **Tastatur:** Pfeile/`j`/`k` bewegen die Auswahl, `←/→` klappen, `Enter` legt eine
     Geschwisteraufgabe direkt darunter an (mit `Shift` eine Unteraufgabe), `Tab`/`Shift+Tab` rücken
     ein und aus, `Alt+↑/↓` sortieren um, `Leertaste` schaltet den Status weiter und
     `Shift+Leertaste` zurück (auch bei Milestones), `e`/`F2` bearbeitet den Titel in der Zeile, `a` archiviert, `Entf` legt in den
     Papierkorb, `n` oder `/` springt in die Erfassungszeile.
   - **Drag & Drop:** über einer Aufgabe drei Zonen (davor, hinein, danach), über Milestone und
     Gruppe nur „hinein“. Der Platz geht als `index` an den Server, der die Geschwister lückenlos
     neu nummeriert – ganzzahlige Ordnungswerte bleiben ganzzahlig.
   - **Zeichen-Editor: Excalidraw** (`@excalidraw/excalidraw`), nachgeladen, damit das Startpaket
     klein bleibt. Die Szene liegt als JSON in `drawing.shapes`; das Startpaket liefert nur die
     Namen, die Szene holt der Editor. Gespeichert wird 1,5 s nach der letzten echten Änderung und
     beim Schließen, mit derselben Versionsprüfung wie überall.

   Noch offen aus diesem Schritt: die Einbettung `![[zeichnung:Name]]` in der Beschreibung – dafür
   fehlt im Inspektor bislang der Beschreibungs-Editor.
9. ~~SSE-Push und Konfliktbehandlung.~~ **Erledigt.**
   - **`GET /api/events`** ist ein SSE-Strom hinter derselben Sitzungsprüfung wie alles andere, mit
     Lebenszeichen alle 25 Sekunden gegen zudrückende Proxys. Der Verteiler (`src/server/events.ts`)
     ist eine Liste von Zuhörern im Speicher – ein Prozess, ein Nutzer, mehr braucht es nicht.
   - **Kleine Änderungen tragen das Objekt bei sich** (`upsert`), der Empfänger tauscht es aus.
     Alles, was viele Zeilen auf einmal betrifft – Verschieben, Archivieren, Löschen, Papierkorb –
     meldet nur „neu laden“. Das ehrlich zu sagen ist billiger, als einen halben Teilbaum einzeln
     nachzuführen und dabei etwas zu übersehen. Mehrere solche Meldungen kurz hintereinander
     ergeben ein einziges Nachladen.
   - **Jeder Tab nennt sich** im Header `x-tasker-client`; der Strom trägt die Kennung zurück, damit
     ein Tab seinen eigenen Hall übergeht.
   - **Nach einem Abbruch** verbindet sich der Browser von selbst neu, und der Client lädt einmal
     komplett nach – verpasste Meldungen werden nicht nachgereicht. Bleibt der Strom länger als drei
     Sekunden weg, steht „offline“ im Kopf.
   - **Optimistische Änderungen:** ein `PATCH` wirkt sofort in der Anzeige, die Antwort des Servers
     ersetzt sie. Bei `409` gilt der Stand des Servers und der Client sagt es; bei jedem anderen
     Fehler wird zurückgerollt. Anlegen, Verschieben und Löschen warten weiterhin auf den Server,
     weil erst er ID und Reihenfolge vergibt.

   Der Strom ist damit eine Bequemlichkeit, keine Wahrheit: was vor stillem Datenverlust schützt,
   bleibt die Versionsprüfung beim Schreiben.

   `POST /api/bulk` kam mit der Mehrfachauswahl, der Undo-Stack aus Abschnitt 5 mit `POST
   /api/steps` – beides steht unter „Angleichen an den Prototyp“.
10. Import: erst der Prototyp-Export (damit die eigenen Daten mitkommen), dann Codecks.
   - **Codecks (Server fertig):** `POST /api/import/codecks` liest den CSV-Export („Export as CSV“
     über die Mehrfachauswahl), mit `dryRun` als Vorschau. Zuordnung in `src/server/codecks.ts`:
     Deck einer Karte ohne Hero-Card → Kategorie, Deck unter einer Hero-Card → Label, Deck
     „Backlog“ → nichts; Hero-Card → Aufgabe mit Unteraufgaben; Milestone → geplant mit festem
     Ende; Doc-Karte → Doku; Priorität 3/2/1 → hoch/mittel/niedrig; `unclear` → Status Unklar;
     Effort und Owner fallen weg. Der Export kennt keinen Arbeitsstand – alles kommt offen an.
     Ein vorhandenes Projekt gleichen Namens bricht den Import ab.
   - **Import-Dialog:** unter „Profil & Einstellungen“ (Menü unten links): Datei wählen, Vorschau,
     „Importieren“. Nur für den Umzug gedacht – kann danach wieder raus.

### Verweise im Text (über den Prototyp hinaus)

Wunsch des Nutzers, wie die Kartenverweise in Codecks: `$142` in einer Beschreibung zeigt auf die
Aufgabe oder den Milestone mit dieser Nummer.

- Jede Aufgabe und jeder Milestone hat eine **feste, kurze Nummer** (`ref`), eine gemeinsame Folge.
  Vergeben wird sie von Triggern beim Einfügen (Migration 0005, Zähler in `ref_seq`), so bekommen
  auch Kopien, Importe und alte Papierkorb-Einträge eine. Nummern werden nie wieder vergeben. Die
  Migration nummeriert Bestehendes in der Reihenfolge des Anlegens.
- Gespeichert wird nur die Nummer; angezeigt wird der **aktuelle Titel** als Link (◆ für Milestones,
  📄 für Dokumente, durchgestrichen wenn erledigt, blass wenn archiviert). Ein Klick springt hin,
  Archiviertes öffnet das Archiv. Unbekannte Nummern bleiben als `$999` stehen, blass.
- Beim Schreiben öffnet `$` eine Suche (Titel oder Nummer, eigenes Projekt zuerst); ↑/↓, Enter/Tab,
  Escape schließt nur die Liste.
- Die Nummer steht oben rechts im Inspektor; ein Klick kopiert `$142`.
- **Codecks-Verweise** (`$3yw`) in importierten Texten wandelt „Codecks-Verweise umwandeln“ im
  Profil-Dialog um (`POST /api/import/codecks-refs`, erst Vorschau): das Kürzel steht im „Card
  link“ des Exports, das Ziel wird über Projekt und Titel gefunden (auch im Archiv). Ohne
  eindeutiges Ziel wird daraus ein Link zur Karte in Codecks. Code bleibt unberührt. Kürzel aus
  reinen Ziffern, wenn der Export die Karte kennt oder die Zahl über der höchsten vergebenen
  Tasker-Nummer liegt (sonst träfe sie später, wenn der Zähler dort ankommt, eine falsche
  Aufgabe); unbekannte darunter bleiben stehen und heißen in der Vorschau „unklar“. Jedes Projekt
  nur einmal (`setting codecks.refs.<projectId>`) – danach könnten dort echte Tasker-Nummern stehen.
- Links nach draußen öffnen einen neuen Tab und nicht den Editor.

### Bilder (über den Prototyp hinaus)

Wunsch des Nutzers. Bilder liegen als BLOB in der Datenbank (Tabelle `image`) und nicht als Dateien
daneben – so hängen sie am Papierkorb und an „Rückgängig“, statt einen zweiten Zustand zu bilden,
der auseinanderlaufen kann. Der Schlüssel ist der **Inhalts-Hash**: dasselbe Bild zweimal eingefügt
ist eine Zeile, und die Auslieferung darf `immutable` setzen.

- **Immer WebP**, mit einer einstellbaren Obergrenze je Bild (`imageMaxKb`, Vorgabe 500) und
  Kantenlänge (`imageMaxEdge`, Vorgabe 2560). Umgewandelt wird im Browser vor dem Hochladen
  (`src/client/ui/imageFile.ts`). Die Größe wird nicht gerechnet, sondern gemessen: Qualität per
  Intervallhalbierung, und erst wenn die am Boden ist, fällt die Kantenlänge. Dadurch ist die
  Grenze eine Zusage. Animierte GIFs und SVG werden abgelehnt.
- **Herein kommt es** über Einfügen aus der Zwischenablage und Ziehen ins Fenster – kein
  Dateidialog (ausdrücklicher Wunsch). Im Editor landet der Verweis an der Cursorposition, auf der
  Karte am Ende des Textes.
- **Im Text** steht ein gewöhnliches Markdown-Bild auf `/api/bilder/<id>`; `marked` rendert das ohne
  Sonderweg, anders als bei `![[zeichnung:…]]`.
- **Ein Bild gehört zu einem Projekt** (dem, in dem es hochgeladen wurde), aber ohne Fremdschlüssel:
  ein gelöschtes Projekt soll die Bytes nicht mitnehmen.
- **Wer es verwendet, wird nachgesehen und nicht mitgeschrieben** (`usage` in
  `src/server/images.ts`): einmal über alle Beschreibungen von Aufgaben und Milestones plus die
  Nutzlasten im Papierkorb. Eine mitgeführte Tabelle müsste bei Rückgängig, Papierkorb, Umwandeln
  und Import korrekt mitlaufen – und eine Galerie, die „nicht mehr verlinkt“ fälschlich behauptet,
  löscht Bilder, die noch gebraucht werden.
- **Die Galerie** ist ein eigener Reiter (`src/client/ui/Gallery.tsx`), ein Bestand wie das Archiv.
  Sie zeigt je Bild Maße, Größe, Datum und die Verwendungen (anklickbar) und filtert nach: ohne
  Verwendung, nur noch archiviert, nur noch im Papierkorb, älter als. Dazu Sortierung und die
  Gesamtgröße – ohne die weiß man nie, ob Aufräumen lohnt.
- **Ordner** (`image_folder`, Wunsch des Nutzers): verschachtelt, je Projekt, und ein Bild liegt in
  genau einem oder in keinem. Sie stehen als Kacheln im Raster, die Spur darüber führt zurück und
  nimmt selbst Ablagen an. Angelegt werden sie über das Kontextmenü der freien Fläche, geöffnet mit
  Doppelklick – beides Wunsch des Nutzers: kein Knopf in der Leiste, kein Dialog. Ein Ordner ist eine
  reine Hülle, deshalb zwei Menüeinträge statt einer Rückfrage: „Ordner auflösen“ hebt den Inhalt
  eine Ebene höher, „Ordner löschen“ nimmt ihn mit – die Bilder des ganzen Astes wandern dabei in den
  Papierkorb und sind von dort einzeln zurückzuholen. Umgehängt gilt das Projekt des neuen
  Platzes für den ganzen Ast – sonst lägen in einem Ordner Bilder, die im eigenen Projekt nicht mehr
  zu sehen sind. Die Filter kennen keine Ordner: unter „Alle“ ist die Galerie eine Ablage, unter
  jedem anderen Filter eine Suche durch den ganzen Ast darunter.
- **Auswahl in der Galerie** (`imageSel` im Speicher): anklicken wählt eines, Strg nimmt dazu,
  Umschalt den Bereich. Bewusst nicht `selected` und nicht `multi` – der Inspektor soll weiter die
  offene Aufgabe zeigen, während man daneben Bilder für sie zusammenstellt; ein Bild wird nie im
  Inspektor geöffnet. Die Sammelaktionen stehen in einer Leiste über dem Raster: an die offene
  Aufgabe anhängen (ein `patch` für alle) und in den Papierkorb (ein „Rückgängig“ für alle). Das
  Rechtsklickmenü hat den Papierkorb, aber kein „Anhängen“ – das geht dort per Ziehen auf den Inspektor. Ein Filterwechsel hebt die Auswahl auf – was man nicht mehr sieht, soll
  man nicht aus Versehen löschen.
- **Aus der Galerie ziehen:** ein Bild auf die Beschreibung im offenen Inspektor hängt es ans Ende
  des Textes; gehört es zu einer Auswahl, wandert die ganze Auswahl mit. Das baut darauf, dass die
  Auswahl den Reiterwechsel überlebt.
- **Löschen geht über den Papierkorb.** Die Bytes bleiben liegen, nur `deleted_at` wird gesetzt; der
  Eintrag trägt die Bild-ID, nicht das Bild (als Base64 wäre es ein Drittel größer). Beim Leeren
  fallen die Bytes – und **das lässt sich nicht zurücknehmen**. Deshalb kommt ein Bild-Eintrag gar
  nicht erst in die Rückgängig-Liste, die Rückfrage sagt es vorher, und die Meldung danach auch.
- **Beim endgültigen Entfernen** tritt in jeder Beschreibung `[BILD WURDE GELÖSCHT]` an die Stelle
  des Verweises (`stripRefs`), auch in den Nutzlasten im Papierkorb – sonst zeigte eine später
  wiederhergestellte Aufgabe ein kaputtes Bild ohne Erklärung. Solange das Bild nur im Papierkorb
  liegt, bleiben die Texte unberührt: es wird ja weiter ausgeliefert.

### Beschreibung schreiben (über den Prototyp hinaus)

Wunsch des Nutzers – das Beschreibungsfeld (Inspektor und Mehrfachauswahl, `useSmartEditor` in
`src/client/ui/editor.tsx`):

- **Enter** in einem Listenpunkt (`- `, `* `, `1. `, mit oder ohne `[ ]`/`[x]`) beginnt den
  nächsten; eine Checkbox kommt immer offen mit, Nummern zählen weiter. Das gilt auch in einer
  eingerückten Folgezeile eines Punktes – der neue Punkt steht auf dessen Ebene. Enter im leeren Punkt
  beendet die Liste (eingerückt: eine Ebene hinauf). **Shift+Enter** bricht ohne neuen Punkt um
  und rückt die neue Zeile – wie in Codecks – so weit ein, dass sie noch zum Punkt gehört; in
  einer solchen Folgezeile bleibt deren Einrückung (`breakInItem`).
- Jeder Zeilenumbruch wird auch angezeigt (`breaks` in `marked`), Folgezeilen eines
  Checklisten-Punkts stehen unter dessen Text – wie in Codecks.
- **Checkboxen zu Unteraufgaben** (wie in Codecks): der Text hinter `[ ]` wird der Titel, alles
  tiefer Eingerückte (auch über Leerzeilen, samt eingerückter Checkboxen) die Beschreibung; in der
  Beschreibung bleibt `- $123` stehen. Alle offenen Punkte der obersten Ebene über das
  Kontextmenü oder die Werkzeugleiste, einzelne über den Knopf, der beim Überfahren neben der
  Checkbox erscheint. Abgehakte bleiben stehen. Zerlegung in `src/shared/checklist.ts`
  (`checklistItems`), serverseitig `POST /api/checklist`, rücknehmbar.
- **Werkzeugleiste** (bewusste Abweichung vom Prototyp, dort „+ Zeichnung“ als Link darunter): in
  der Ansicht oben rechts in der Beschreibung, sichtbar beim Überfahren – Bild, Zeichnung,
  Checkboxen zu Unteraufgaben (mit Anzahl, nur wenn es offene gibt). Im Editor steht sie immer
  über dem Feld, zusätzlich mit Checkliste, Liste und Verweis (`$`); eingefügt wird an der
  Schreibmarke, Umwandeln übernimmt vorher den ungespeicherten Text.
- **Tab / Shift+Tab** rücken Listenpunkte ein und aus (alle markierten), unter den Inhalt des
  Punktes darüber; nummerierte zählen auf der neuen Ebene neu. Außerhalb von Listen bleibt Tab,
  was es war. Die Textlogik steht rein in `src/shared/listEdit.ts`.
- **Alt+↑/↓** verschieben die Zeile der Schreibmarke – bei einer Markierung den ganzen Block –
  nach oben oder unten, gleich was darin steht. Dieselbe Kombination, die in der Liste eine Zeile
  umsortiert; im Textfeld greift die der Liste nicht, dort wird ja getippt.
- **`/`** öffnet ein Befehlsmenü wie `$` (gemeinsame Mechanik in `caretMenu.tsx`). Befehle stehen
  in `SLASH_COMMANDS` – bisher „TodoListe“ und „Liste“; weitere kommen dort dazu. Auf einer leeren
  Zeile beginnt der Befehl diese, hinter Text eine neue.
- Änderungen gehen über `insertText`, damit Strg+Z sie wie Getipptes zurücknimmt.
11. Gamification, dezent.

### Suche (über den Prototyp hinaus)

Wunsch des Nutzers (02.10.2026): eine Such-Palette über der Ansicht statt eines Filters in der
Liste – der fände nur, was im offenen Reiter liegt.

- **Öffnen:** Lupe links in den Aktionen der Titelzeile, `/` oder Strg+K (das auch aus einem
  Textfeld heraus). Escape, Klick daneben und „Zurück“ schließen. Zeichen-Editor und
  Abhängigkeits-Board behalten ihre Tasten. Die Palette ist ein Dialog (`dialog: 'search'`).
- **Gesucht wird** in Titel und Beschreibung von Aufgaben, Dokumenten und Milestones des aktiven
  Bestands, im Client (`shared/search.ts`) – jedes Wort muss vorkommen. `142` findet auch die
  Nummer, `$142` nur sie; `#bug` grenzt auf ein Label ein (Anfang reicht, geerbte zählen mit) und
  lässt sich mit Text verbinden.
- **Bereich:** das aktuelle Projekt oder alle – Vorgabe ist, was die Seitenleiste zeigt; Tab
  wechselt. Über alle Projekte steht das eigene zuerst.
- **Reihenfolge** im Projekt: Erledigtes zuletzt; davor Nummer, Titelanfang, Titel, Beschreibung.
  Höchstens 50 Treffer stehen da.
- **Zeile:** Status bzw. ◆/Seite, Titel mit markierter Fundstelle, Labels, `$Nummer`; darunter der
  Ort (Reiter › Behälter › Eltern) oder der Ausschnitt aus der Beschreibung.
- **Leeres Feld:** „Zuletzt geöffnet“ – die letzten Ausgewählten, pro Gerät (`tasker.recent`).
- **Enter** springt hin (`reveal`): Reiter, aufgeklappte Behälter, Auswahl, Inspektor.
- **Archiv** ist ein eigener Schalter, Vorgabe aus: fragt `GET /api/archive` mit dem Suchtext und
  findet deshalb nur Titel, und den Text am Stück. Der Sprung öffnet das Archiv mit dem Titel als
  Suche, damit der Eintrag trotz Seiten sicher dasteht.
- Bilder und Zeichnungen sind nicht dabei.

### Tisch: der aktive Milestone (über den Prototyp hinaus)

Wunsch des Nutzers (30.09.2026): eine verspielte, kartenbasierte Ansicht für die Arbeit am aktiven
Milestone – mit dem belohnenden Gefühl, eine Karte auf den Erledigt-Stapel zu legen, wie in
Codecks. Die Ansicht ist ein eigener Reiter **„Tisch“**. Sie **ersetzt die zuerst geplante
„Hand“** (eine Kartenreihe oben im Plan); die ist verworfen.

**Der aktive Milestone**

- Aktiv ist der Milestone mit dem Status **In Progress**; ein eigenes Kennzeichen gibt es nicht.
- ~~**Je Projekt höchstens einer.**~~ Seit den Releases (10.10.2026) dürfen mehrere Milestones
  gleichzeitig aktiv sein; der Tisch zeigt dann die Karten aller – siehe „Releases“, „Milestones
  laufen parallel“. Was in diesem Abschnitt von „dem aktiven Milestone“ spricht, gilt je
  Milestone.
- Eine bearbeitete Aufgabe gehört immer zu einem Milestone – der Nutzer führt darüber ein
  Changelog. Auf den Tisch kommt ein Task deshalb nur über die bestehenden Wege in den Milestone;
  einen eigenen Weg aus Ready oder Backlog auf den Tisch gibt es nicht.

**Aufbau (Entwurf „Spieltisch hochkant“)**, von oben nach unten – oben, was noch kommt, unten, was
man gerade in der Hand hat:

- **Kopf:** Name des Milestones, Fortschritt in Punkten als Balken, verbleibende Tage laut
  Zeitplan.
- **Gesperrt:** Tasks mit offenen Voraussetzungen, angekettet, mit der Zahl der offenen
  Voraussetzungen. Lassen sich nicht ausspielen.
- **Offen / frei:** die große Fläche in der Mitte.
- **Im Spiel:** entspricht In Progress. Sieben leere Plätze zeigen einen Richtwert (wie in
  Codecks), begrenzt wird aber nicht – es dürfen mehr Karten ins Spiel.
- **Erledigt-Stapel** unten rechts, schief aufeinanderliegende Karten mit Zähler.

Verschieben zwischen den Zonen setzt den Status (Offen, In Progress, Erledigt). Status
**Blockiert** liegt in „Gesperrt“, **Unklar** in der mittleren Fläche mit einer Markierung.

**Kein aktiver Milestone:** eine eigene, gern verspielte leere Ansicht („kein aktiver
Milestone“), etwa ein leerer Tisch. **Milestone fertig:** vorerst passiert nichts Besonderes; der
Nutzer will das erst beim Verwenden entscheiden.

**Unteraufgaben**

- Ein Task mit Unteraufgaben ist eine **Stapelkarte**: Zähler („2/5“) und je Unteraufgabe ein Punkt
  im Status. Ein Stapel belegt keinen Platz in „Im Spiel“ und bleibt in der mittleren Fläche.
- **Auffächern:** Klick auf den Stapel öffnet darunter eine Schublade über die ganze Breite mit den
  Unteraufgaben. Unter-Unteraufgaben sind darin wieder Stapel mit einer eingerückten Schublade;
  jede trägt eine Brotkrume („Icons › App-Icons“). Mehrere Schubladen dürfen offen sein.
- Unteraufgaben lassen sich aus der Schublade ausspielen; auf dem Spielfeld tragen sie die
  Brotkrume, in der Schublade bleibt ein blasser Umriss. Gesperrte Unteraufgaben liegen
  angekettet in ihrer Schublade (nicht zusätzlich oben in „Gesperrt“). Erledigte bleiben blass mit
  Häkchen liegen.
- Sind alle Unteraufgaben erledigt, wird der Stapel **nicht** von selbst erledigt (bestehende
  Regel, `parentStatus.ts`); er zeigt „fertig“ und wartet darauf, abgelegt zu werden.

**Animationen** – ausdrücklicher Wunsch, sie sind der Kern der Ansicht:

- Ausspielen: Die Karte hebt sich, kippt beim Ziehen (`cardTilt.ts`) und landet mit leichtem
  Nachfedern auf ihrem Platz.
- Ablegen: Die Karte fliegt auf den Stapel und bleibt leicht verdreht liegen; der Zähler springt,
  „+n Pkt“ steigt auf, der Balken im Kopf füllt sich sichtbar.
- Stapel ablegen: ein größerer Moment als eine einzelne Karte.
- Freischalten: Wird die letzte Voraussetzung erledigt, springt die Kette auf, die Karte dreht
  sich um und gleitet von „Gesperrt“ nach „Offen“.
- Ungültiger Zug (gesperrte Karte ausspielen): Die Karte schüttelt sich und gleitet
  zurück.
- Schublade: fährt auf, die Karten fächern leicht versetzt heraus.
- Bei `prefers-reduced-motion` nur kurze Überblendungen.

Der Reiter „Tisch“ steht als **erster**, vor Plan.

**Umgesetzt (01.10.2026):** Logik in `src/shared/tisch.ts` (Zonen, Sperren, aktiver Milestone,
mit Tests), Ansicht in `src/client/ui/Tisch.tsx` und `tisch.css`, Animationen in `tischFx.ts`. Die
Sperre „nur ein aktiver Milestone“ prüft der Server beim Ändern und Anlegen (`assertSingleActive`
in `repo.ts`); Inspektor und Kontextmenü sperren „In Progress“, die Leertaste meldet es. Kleinere
Festlegungen dabei, vom Nutzer bestätigt:

- Unter „Alle Projekte“ zeigt der Tisch nur den Hinweis, ein Projekt zu wählen.
- Ohne aktiven Milestone bietet der leere Tisch „◆ … starten“ für den obersten offenen im Plan an.
- Ein Klick markiert eine Karte nur (ein Stapel klappt dabei auf oder zu), erst ein
  **Doppelklick öffnet den Inspektor** (Wunsch des Nutzers).
- Der Zähler am Erledigt-Stapel zählt Erledigtes jeder Ebene, auch Unteraufgaben.
- Filter aus der Seitenleiste gelten auf dem Tisch nicht; die Filterleiste ist dort ausgeblendet.
- Offene Schubladen merkt sich das Gerät (`tasker.tischOpen`).

Nachgezogen (Wunsch des Nutzers):

- **Tastatur:** Pfeiltasten wandern zwischen den Karten, die Leertaste schaltet den Status der
  markierten Karte weiter (Umschalt zurück). Ein Stapel springt dabei von Offen direkt auf
  Erledigt, weil er nie ins Spiel kommt; gesperrte Karten schütteln sich.
- **Im Spiel** bleibt eine Reihe und scrollt seitlich, statt umzubrechen – ohne Scrollleiste; das
  Mausrad scrollt dort seitlich, ebenso in den Reitern oben (`wheelX.ts`).
- Die **oberste Karte des Erledigt-Stapels** lässt sich wieder herausziehen (auf Offen oder ins
  Spiel).
- Erst **entsperren, dann umräumen:** Eine freigeschaltete Karte wird an ihrem alten Platz
  entsperrt; erst danach bewegen sich die Karten.
- **Jeder Zonenwechsel ist animiert**, auch über Leertaste, Inspektor oder andere Tabs – nicht nur
  beim Ziehen. Gerade Erledigtes ohne Zeitpunkt (der Inspektor setzt den Status vor der Antwort
  des Servers) liegt dabei obenauf, sonst sprang die Karte ohne Weg auf den Stapel.
- **Von Hand sortieren** in „Offen“ und „Im Spiel“: zwischen zwei Karten abgelegt (Einfügemarke wie
  im Kartenraster) wird sortiert. „Offen“ ist dabei die Reihenfolge im Plan – dort sortiert, steht
  es auch im Plan so; der Status bleibt. „Im Spiel“ hat eine eigene Reihenfolge quer über alle
  Stapel (`playOrder` am Task, Migration 0015): wer ins Spiel kommt, reiht sich hinten ein
  (Server, `nextPlayOrder`), und eine Karte lässt sich gleich an einen Platz ausspielen. Offen:
  „Gesperrt“ und die Schubladen sortieren nicht, und eine Karte aus einer anderen Zone landet in
  „Offen“ an ihrem Platz im Plan, nicht an der Ablagestelle.
- **Ablage: der aufgedeckte Erledigt-Stapel** (nach Codecks, Entwurf vom Nutzer bestätigt). Ein
  Klick auf den Stapel oder seinen Zähler legt die Ablage über „Gesperrt“ und „Offen“: je Woche
  (Montag bis Sonntag, Ortszeit, jüngste oben), was im aktiven Milestone erledigt wurde, mit
  Wochentag und Uhrzeit über jeder Karte. Esc, ✕ oder ein weiterer Klick sammelt wieder ein.
  Gamification: Balken je Woche gegen das Tempo aus den Einstellungen („Ziel geschafft“), Krone
  für die beste Woche, Serie der Wochen in Folge, am Stapel „n diese Woche“ – und Funken, wenn
  die Karte abgelegt wird, die das Wochenziel voll macht. Festlegungen: fürs Ziel zählen nur
  Karten ohne Unteraufgaben; erledigt Archiviertes bleibt liegen und zählt mit (blass, nicht
  anfassbar); jede andere Karte lässt sich zurück auf „Offen“ oder ins Spiel ziehen – die Ablage
  tritt beim Ziehen zur Seite. Logik in `doneShelf` (`src/shared/tisch.ts`, mit Tests).

### Releases (über den Prototyp hinaus)

Wunsch des Nutzers (10.10.2026). Bisher sammelt er das Changelog im Milestone und führt die Stages
(Implementierung, itch-Release) dort als Checkliste – damit ist jeder Milestone genau ein Release.
Er will mehrere Milestones in ein Release packen und auf mehreren Plattformen veröffentlichen
können (etwa Steam-Demo und itch-Seite). **Stand: alle sieben Schritte umgesetzt (10.10.2026).**

**Das Release**

- Ein eigenes Objekt je Projekt: Version (freier Text), Titel, Beschreibung (Einleitung fürs
  Changelog), Reihenfolge, archivierbar.
- **Stages** sind zweierlei: jeder zugeordnete Milestone ist eine Stage (Fortschritt und Status
  kommen vom Milestone), dazu je Kanal eine Veröffentlichungs-Stage (itch-Seite, Steam-Demo, …),
  einzeln abhakbar und untereinander parallel. Ein neues Release übernimmt die Kanäle des
  vorherigen im Projekt; eine eigene Plattform-Verwaltung gibt es nicht.
- Ein Milestone gehört zu **höchstens einem** Release, sonst stünde ein Task in zwei Changelogs.
- Der Status wird berechnet, nicht gespeichert: geplant → in Arbeit → bereit (alle Milestones
  fertig) → veröffentlicht (alle Kanäle abgehakt).
- Abhängigkeiten **zwischen Releases** gibt es nicht; ihre Reihenfolge reicht.

Daten: Tabelle `release` (`project_id`, `name`, `title`, `desc`, `sort_order`, `archived_at`),
Tabelle `release_stage` (`release_id`, `name`, `sort_order`, `done_at`), Spalte
`milestone.release_id`. Die Versionsbezeichnung steht in `name`, weil `version` an jeder Tabelle
schon die Konflikterkennung ist.

**Umgesetzt (10.10.2026), Schritt 1 – nur die Daten, noch ohne Oberfläche:** Migration 0017,
Release und Kanal als Typen `release` und `stage` der Objektrouten (`/api/kind/…`), im Startpaket
als `releases` und `stages`. Festlegungen dabei:

- Abgehakt wird ein Kanal über `doneAt`; den Zeitpunkt schickt der Client, `null` nimmt den Haken
  zurück.
- Ein Milestone nimmt nur ein Release des eigenen Projekts an. Wechselt er das Projekt, bleibt
  das Release zurück; „Rückgängig“ holt es wieder.
- Wie ein Milestone seine Aufgaben nimmt ein gelöschtes Release seine Milestones nicht mit in den
  Papierkorb: sie lösen sich und kehren beim Wiederherstellen zurück, sofern sie inzwischen in
  keinem anderen Release stecken. Die Kanäle gehen mit dem Release und kommen mit ihm zurück.
- Ein Milestone aus dem Papierkorb, dessen Release es nicht mehr gibt, kommt ohne Release zurück.
- Archivieren lässt sich ein Release noch nicht – die Spalte steht, der Weg kommt mit dem Reiter.

**Aufbau im Abhängigkeitsgraphen**

Der Graph ist der visuelle Editor dafür, welche Milestones in welches Release gehen und welche
voneinander abhängen.

- Das Release ist ein Knoten. Ein Pfeil vom Milestone zum Release heißt wie überall „Release
  benötigt Milestone“ und ist zugleich die Zuordnung. Gespeichert wird sie als `release_id` am
  Milestone – der Pfeil ist nur deren Darstellung, es gibt keine zweite Wahrheit in `dependency`.
- Pfeile zwischen Milestones bleiben die bestehenden Abhängigkeiten.
- Ausschnitt vom Release aus: das Release, seine Milestones und alles, was diese benötigen. Die
  Liste links führt die Releases als ziehbare Einträge.
- Die Kanäle stehen als abhakbare Punkte im Release-Knoten, nicht als eigene Knoten.

**Umgesetzt (10.10.2026), Schritt 2:** in `DepGraph.tsx`; der berechnete Status steht in
`src/shared/release.ts` (mit Tests). Festlegungen dabei:

- Der Pfeil in ein Release ist gestrichelt – er ist eine Zuordnung, keine Abhängigkeit. Steckt
  der Milestone schon in einem anderen Release, zieht er um. Entf oder das Menü am Pfeil nimmt
  ihn wieder heraus.
- Aus einem Release führt kein Pfeil heraus; hinein führen nur Milestones.
- Angelegt wird ein Release im Graphen: „+ Release“ im Kopf (landet rechts neben allem) oder
  „Neues Release“ im Menü der freien Fläche (landet dort). Es öffnet sich gleich als Formular.
- Ein Doppelklick macht den Release-Knoten zum Formular für Version, Titel und Kanäle – einen
  Inspektor hat ein Release noch nicht. Die Kanäle hakt man direkt im Knoten ab.
- Die Liste links führt die Releases oben, je mit ihren Milestones.
- Veröffentlicht ist ein Release, sobald alle Kanäle abgehakt sind – auch wenn ein Milestone noch
  offen ist; der Haken ist die Aussage des Nutzers.

**Reiter „Releases“**

Übersicht je Projekt: Version, Titel, berechneter Status, die Milestones mit Fortschritt, die
Kanäle zum Abhaken, darunter das Changelog. Zugeordnet wird im Graphen und über ein Feld „Release“
im Inspektor des Milestones; im Plan trägt ein Milestone seine Version als Chip.

**Umgesetzt (10.10.2026), Schritt 3:** `Releases.tsx`, Reiter hinter dem Zeitplan. Festlegungen
dabei:

- Das jüngste Release steht oben. Unter „Alle Projekte“ stehen die Releases aller Projekte mit
  Projektname; angelegt wird im zuletzt gewählten.
- Version, Titel und Kanalnamen sind Felder, die wie Text aussehen und beim Verlassen speichern.
- Milestones lassen sich auch hier zuordnen („+ Milestone“) und herausnehmen; aufgebaut wird
  sonst im Graphen, den der Knopf im Kopf öffnet.
- Archivieren und Löschen stehen im Menü „⋯“. Archivierte Releases blendet ein Link ein.
- Archivierte Milestones bleiben am Release stehen und gelten als fertig – der aktive Bestand
  kennt sie nicht, deshalb kommen sie mit dem Changelog vom Server (`GET /api/changelog/<id>`).
  Im Graphen fehlen sie weiterhin.

**Changelog**

- Das Changelog hängt am Task, mit drei Zuständen: **unentschieden** (Vorgabe), **Eintrag** (eine
  Zeile in Spielersprache, unabhängig vom Titel) und **kein Eintrag** (bewusst, weil zu
  technisch).
- Das Release sammelt die Einträge aller Tasks seiner Milestones. Noch nicht Erledigtes steht
  blass dabei – die Vorschau auf das, was kommt.
- Erledigte Tasks ohne Entscheidung stehen in einer eigenen Liste im Release: eine Zeile tippen
  oder „Technisch“. Unteraufgaben erben die Entscheidung des Elternteils. Der **Tisch fragt beim
  Ablegen nicht** danach.
- **Frei belegbare Liste** (Wunsch des Nutzers, statt Abschnitten aus der Markierung – die
  bekäme sonst zu viel Logik): Die Einträge eines Releases sind eine Liste, die sich per Drag &
  Drop ordnen lässt, mit einfachen Überschriften, die man dazwischen einfügt. Neue Einträge
  reihen sich hinten ein. Markierungen spielen fürs Changelog keine Rolle.
- **Alle Kanäle bekommen dasselbe Changelog.**
- Ausgabe: als Markdown kopieren, die Beschreibung des Releases obenauf.

Daten: `task.changelog` (Text), `task.changelog_skip` (kein Eintrag), `task.changelog_order`
(Platz in der Liste); Tabelle `release_heading` (`release_id`, `title`, `sort_order`) im selben
Zahlenraum wie `changelog_order`. Die Sammellogik kommt nach `src/shared`, mit Tests.

**Umgesetzt (10.10.2026), Schritt 4:** Migration 0018, Logik in `src/shared/changelog.ts`.
Festlegungen dabei:

- **Auch Archiviertes zählt.** Erledigtes wird hier regelmäßig archiviert und gehört trotzdem
  ins Changelog. Deshalb kommt die Grundlage gesondert vom Server (alle Aufgaben unter den
  Milestones des Releases, auch archivierte), und geändert wird über Schritte (`/api/steps`),
  die auch archivierte Aufgaben erreichen – mit „Rückgängig“.
- Das Feld „Changelog“ im Inspektor gibt es nur an Aufgaben in einem Milestone: eine Zeile
  schreiben oder „Technisch“ drücken.
- Ein neuer Eintrag bekommt den nächsten freien Platz **des Projekts**, nicht des Releases – so
  bleibt er hinten, auch wenn sein Milestone das Release wechselt.
- Ohne Entscheidung gilt eine erledigte Aufgabe nicht mehr, wenn eine Aufgabe über ihr
  entschieden ist oder alle ihre Unteraufgaben entschieden sind.
- Sortiert wird am Griff links: ziehen oder Alt+↑/↓. Überschriften kommen mit „+ Überschrift“
  hinten dazu und werden an ihren Platz gezogen; beim Entfernen gehen sie ohne Papierkorb.
- „✕“ an einem Eintrag markiert die Aufgabe als technisch; unter „Ohne Eintrag“ lässt sich das
  zurücknehmen.
- „Als Markdown kopieren“ gibt nur Erledigtes aus und lässt Überschriften weg, unter denen
  nichts steht. Offene Einträge stehen in der Liste blass mit „noch offen“.
- Eine duplizierte Aufgabe übernimmt den Eintrag nicht.

**Milestones laufen parallel**

Weil ein Release aus mehreren Milestones gespeist wird, fällt die Regel „je Projekt höchstens ein
aktiver Milestone“ aus dem Abschnitt „Tisch“ weg – ohne Einschränkung, also nicht nur innerhalb
eines Releases. Es entfallen `assertSingleActive` im Server, die Sperre von „In Progress“ in
Inspektor und Kontextmenü und die Meldung der Leertaste.

Der **Tisch** zeigt dann die Karten aller aktiven Milestones des Projekts in denselben Zonen, mit
einem gemeinsamen Erledigt-Stapel:

- Jeder Milestone bekommt eine Farbe; jede Karte trägt einen farbigen Streifen mit seinem Namen.
- Im Kopf steht je aktivem Milestone ein Fortschrittsbalken in seiner Farbe; ein Klick darauf
  blendet den Tisch auf diesen Milestone ein.
- Ist nur einer aktiv, sieht der Tisch aus wie bisher. Auf den Tisch kommt ein Task weiterhin
  nur, indem er in einen aktiven Milestone kommt.

**Umgesetzt (10.10.2026), Schritt 5.** Festlegungen dabei:

- Die Farbe hängt am Platz des Milestones im Plan. Die Herkunft ist ein kleiner Reiter in dieser
  Farbe mit dem Namen des Milestones, oben an der Karte – in „Gesperrt“, „Offen“ und „Im Spiel“,
  nicht in den Schubladen (dort steht sie am Stapel) und nicht auf dem Erledigt-Stapel.
- Eingeschränkt wird über den Knopf „Nur dieser“ in der Zeile des Milestones; der Klick auf den
  Namen öffnet weiter die Details.
- In „Offen“ und „Gesperrt“ stehen die Milestones nacheinander, „Im Spiel“ und der
  Erledigt-Stapel mischen sich. Sortiert wird in „Offen“ nur innerhalb des eigenen Milestones –
  in einen anderen wandert dort nichts.
- Wochenziel, Serie und Ablage zählen über alle Milestones, die der Tisch gerade zeigt.

**Zeitplan**

- Je Projekt nach Release gruppiert: ein Band je Release mit einer Marke am Ende seines letzten
  Milestones, dazu eine Gruppe „ohne Release“.
- Gerechnet wird weiter nacheinander – der Nutzer arbeitet allein, parallele Milestones teilen
  sich das Tempo. Das Ende eines Releases stimmt dabei unabhängig von der Reihenfolge seiner
  Milestones; nur die Enden der einzelnen Milestones darin sind eine Schätzung. Echte parallele
  Balken mit aufgeteiltem Tempo erst, wenn sie beim Benutzen fehlen.

**Umgesetzt (10.10.2026), Schritt 6:** `releaseGroups` in `src/shared/release.ts`. Die Gruppen
stehen in der Reihenfolge, in der ihr erster Milestone im Plan kommt; ohne ein einziges Release
sieht der Zeitplan aus wie zuvor. Ein Klick auf das Release führt zum Reiter „Releases“.

**Reihenfolge der Umsetzung**

1. Daten: `release`, `release_stage`, `release_id` am Milestone – Migration, Repo, Routen,
   Events, Papierkorb.
2. Graph: Release-Knoten, Zuordnen per Pfeil, Kanäle im Knoten.
3. Reiter „Releases“: Übersicht mit Version, Status und Kanälen.
4. Changelog: Felder am Task und im Inspektor, Sammellogik, Entscheidungsliste, Liste mit
   Überschriften und Drag & Drop, Markdown-Kopie.
5. Parallele Milestones und Tisch. Hängt nicht an den Releases und lässt sich vorziehen.
6. Zeitplan: Gruppierung nach Release.
7. Umstieg: „Release aus Milestone anlegen“ im Kontextmenü. Alte Changelog-Texte bleiben in der
   Beschreibung des Milestones und werden nicht automatisch zerlegt. **Umgesetzt:** im Menü
   „Release“ des Milestones (Kontextmenü und Inspektor) als „Neues Release daraus anlegen“ – das
   Release übernimmt den Titel, die Version trägt der Nutzer nach.

Bewusst nicht dabei: unterschiedliche Changelogs je Kanal, Export in anderen Formaten, Zugriff
per Token.

### Angleichen an den Prototyp

Beim ersten eigenen Durchklicken stellte sich heraus: die Logik ist portiert, die Oberfläche war
aber auf das Nötigste eingedampft. Entscheidung des Nutzers: **1:1 zum Prototyp, Optik und
Funktion** – CSS und Aufbau werden übernommen, nicht nachempfunden.

- ~~**Seitenleiste.**~~ **Erledigt.** Farben, Schriften und Grundformen kommen jetzt unverändert aus
  dem Prototyp (`styles.css`), dazu die Seitenleiste mit „Alle Projekte“, Kategorien, Markierungen
  und Labels als Filter samt Zählern, Theme-Umschalter, Ein-/Ausklappen (`[`), Konto und Fußzeile
  mit Tastenkürzel-Hilfe (`?`) und Papierkorb. Dazu die Dialoge „Kategorien“, „Markierungen“,
  „Profil & Einstellungen“ (mit Passwortwechsel) und die Kürzel-Hilfe. Der Bereich kann jetzt
  „alle Projekte“ sein; die Liste bekommt dann je Projekt eine Überschrift. Neu serverseitig:
  `PATCH /api/account` für Name und Avatar.
- ~~**Zeilen und Spalten.**~~ **Erledigt.** Das Tabellen-Layout des Prototyps: Markierungs- und
  Prioritätsspalte links, dann der eingerückte Baum, danach **Kategorie** und **Labels** an festen
  Positionen (an der Listenbreite ausgerichtet, nicht an der Zeile), rechts **`x/y` plus
  Fortschrittsbalken**. Dazu Statuspunkt mit „unter mir wird gearbeitet“, Checklisten- und
  Zeichnungs-Abzeichen, Schloss für Blockierungen samt Begründung, und die Milestone-Zeile mit
  Status, Zeitraum und der nächsten Handlung („In den Plan →“, „Als Done markieren“,
  „Archivieren“). Gruppenzeilen zählen jetzt offene Aufgaben und haben ein „+“.
- ~~**Inspektor.**~~ **Erledigt.** Pfadzeile mit anklickbaren Stationen (Projekt › Milestone bzw.
  Backlog › Gruppe › Elternkette), Hinweisband für Archiviertes, das zweispaltige Werteraster aus
  dem Prototyp (Status, Fortschritt, Priorität, Kategorie, Markierung, Labels; beim Milestone
  Status, Fortschritt mit Prognose und Zeitraum). Titel und Beschreibung sind **ein** Feld – die
  erste Zeile ist der Titel. Die Beschreibung wird als Markdown gezeigt, Checklisten lassen sich
  direkt abhaken, und `![[zeichnung:Name]]` wird durch die Zeichnung selbst ersetzt (Vorschau von
  Excalidraw, Klick öffnet den Editor). Dazu Unteraufgaben bzw. Tasks des Milestones und die
  Abhängigkeiten in beiden Richtungen mit Suche, die Verknüpftes und Zirkuläres ausblendet.
  Neu dafür: ein Aufklappmenü (`Menu.tsx`) mit Untermenüs, Häkchen und Trennern, sowie `marked`
  und `dompurify` für das Markdown (das Startpaket wächst dadurch von rund 266 auf 390 kB).
- ~~**Kontextmenüs.**~~ **Erledigt.** Der Rechtsklick auf eine **einzelne** Zeile öffnet jetzt das
  Menü aus dem Prototyp – vier Fassungen, je nach Zeile: Aufgabe, Dokumentationsseite, Milestone
  und Gruppe (mit den Sonderfällen „Unsortiert“ und smarte Gruppe). Sie stehen in
  `src/client/ui/rowMenu.ts`; das „⋯“ im Inspektor zeigt dasselbe Menü ohne „Details öffnen“,
  genau wie im Prototyp. Das Menü selbst kann jetzt Tastenkürzel rechts (`kbd`) und die
  Chip-Reihe der Priorität. Ein Klick auf einen Untermenü-Eintrag öffnet ihn nur noch, statt zu
  schalten – sonst schloss der Klick zu, was das Überfahren gerade aufgeklappt hatte.

  Neu dafür: **`POST /api/duplicate`** (kopiert eine Aufgabe samt Unterbaum, Labels und
  Abhängigkeiten und legt die Kopie direkt unter das Original), `projectId` im Patch eines
  Milestones (er nimmt seine Wurzelaufgaben mit ins andere Projekt) und die Taste `B`, die eine
  Aufgabe zurück in den losen Backlog holt. „Nach oben/Nach unten“ für Milestones und Gruppen
  tauscht die beiden Ordnungswerte in **einem** Schritt-Paar über `POST /api/steps`.

  Zwei Abweichungen, beide bewusst: das **Duplizieren lässt sich nicht zurücknehmen** (wie jedes
  Anlegen, siehe Abschnitt 5), und die Priorität steht im Menü als Chip-Reihe, kennt aber kein
  eigenes Tastenkürzel. „Nach oben/Nach unten“ trägt kein `Alt ↑/↓` im Menü, weil die Pfeiltasten
  mit Alt bisher nur Aufgaben verschieben, keine Milestones.
- ~~**Burnup.**~~ **Erledigt.** Die Kurve im Milestone-Inspektor ist `burnupHtml`/`attachBurnup`
  aus dem Prototyp (Committed, Erledigt, Prognose, Heute- und Ende-Linie, Überfahren mit Datum und
  Werten, Hinweise auf Umfangsänderung und Verspätung); bei gleichen Daten sind die Pfade
  zeichengleich. Das Protokoll (`m.log`) steht in `milestone_log`: der Server schreibt es nach
  jeder erfolgreichen Änderung fort (`logScopes` in `src/server/burnup.ts`) und trägt es für
  Milestones ohne Protokoll aus den Abschlusszeitpunkten nach (`backfillLog`). Das Startpaket
  liefert es als `milestoneLog` mit; den aktuellen Punkt rechnet der Client selbst, damit die
  Kurve jeder Änderung sofort folgt. Rückgängig braucht nichts Eigenes: die Rücknahme ist selbst
  eine Änderung und schreibt den Stand neu.

  Zählweise wie im Prototyp: eine Sammel-Aufgabe zählt nur ihre Unteraufgaben, nicht sich
  selbst. Zwischenzeitlich zählte sie auf Wunsch selbst mit (Migration `0004_burnup_neu_zaehlen`);
  das ist wieder zurückgenommen, `0006_burnup_blaetter_zaehlen` leert die in der Zeit
  geschriebenen Protokolle, damit sie neu aufgebaut werden.

  **Abweichung, auf Wunsch:** Der Prototyp führt einen Eintrag pro Kalendertag. Hier trägt jeder
  Eintrag stattdessen den Zeitpunkt der Änderung in UTC (Spalte `at`, Migration
  `0003_milestone_log_at`). Der Server kennt keine Zeitzone; erst der Client verteilt die
  Einträge auf Tage in seiner Ortszeit (letzter Stand je Tag, `toDays` in
  `src/shared/burnup.ts`) und rechnet daraus die Kurve wie der Prototyp.
- ~~**Zeichnungen an Milestones.**~~ **Erledigt.** `drawing` hat jetzt `task_id` oder
  `milestone_id` (genau eins, als CHECK; Migration `0002_drawing_milestone`, die von Drizzle
  erzeugte Kopierzeile las `milestone_id` aus der alten Tabelle und ist von Hand auf `NULL`
  korrigiert). Der Milestone-Inspektor hat „+ Zeichnung“ und die Einbettung wie eine Aufgabe, die
  Milestone-Zeile das Zeichnungs-Abzeichen (`drawingBadge(m)` im Prototyp). Löschen nimmt die
  Einbettung aus der Beschreibung des Milestones, mit Rückgängig. Ein gelöschter Milestone nimmt
  seine Zeichnungen und sein Burnup-Protokoll mit in den Papierkorb und bringt sie zurück (das
  Protokoll ging vorher verloren). API: `?milestoneId=` bzw. `{ milestoneId }` statt `taskId`.

#### Zweiter Abgleich (21.09.2026)

Nach dem Kontextmenü habe ich gemeldet, die Oberfläche sei bis auf zwei Punkte durch – abgeleitet
aus dieser Liste, nicht aus einem Vergleich. Das war falsch. Danach Prototyp und App mit denselben
Beispieldaten (`prototype-parity.json`) nebeneinander verglichen, Ansicht für Ansicht, dazu den
Prototyp-Code vollständig gelesen. Offen ist demnach:

~~**Aussehen**~~ **Erledigt.** Prioritätsfarben, farbiges 📋, Tiefe 1 im Behälter,
SVG-Chevrons, Innenmaß der Liste, `#root` mit voller Höhe (`.main` scrollt jetzt wie im Prototyp
als Ganzes), Schnell-Erfassung mit „+“ und `N`, Tastenleiste am Fuß der Liste, leere Ansichten wie
im Prototyp. Mobil (≤ 900 px): Seitenleiste als Overlay mit Menü-Knopf und Abdunklung,
Inspektor bildschirmfüllend, Labels/Datum/Balken ausgeblendet; zwischen 901 und 1080 px schwebt der
Inspektor rechts. Nebenbei gefunden: Gruppenzeilen waren 40 statt 33 px hoch. Geprüft mit
denselben Daten nebeneinander bei 1400 px (Plan und Backlog: Zeilen, Pfeile, Titel, Tastenleiste
pixelgleich) und 375 px. Bleibt: die Kopfzeile läuft mobil seitlich über – das tut sie im
Prototyp auch (das frühere zusätzliche „+ Aufgabe“ ist inzwischen entfallen, siehe Kopf).

**Liste**
- ~~Zellen nicht anklickbar~~ **Erledigt.** Markierung, Priorität, Kategorie und Labels öffnen
  ihr Menü unter der Zelle (`cellMenu.ts`, wie `openCell`); in einer Mehrfachauswahl gilt es für
  alle. Das Label-Menü bleibt offen und baut sich nach jeder Änderung neu (`keep` im Menü,
  Menü als Funktion), „Neues Label …“ ist ein Textfeld im Menü (Wunsch des Nutzers; im Prototyp
  sprang es ins Labelfeld des Inspektors) – ebenso in der Leiste der Mehrfachauswahl. „+ Label“ erscheint
  beim Überfahren leerer Zeilen. Zellmaße gegen den Prototyp gemessen: deckungsgleich.
- ~~Titel bearbeiten~~ **Erledigt.** `Enter` bestätigt nur – anders als im Prototyp legt es
  keine nächste Aufgabe mehr an, weder beim Anlegen noch beim Umbenennen (Wunsch des Nutzers): die
  Aufgabe bleibt ausgewählt und im Inspektor offen, der Fokus liegt wieder auf der Liste, `Enter` dort legt die
  nächste an. `⇧ Enter`
  eine Unteraufgabe, `Tab`/`⇧ Tab` rückt beim Tippen ein und aus, `Escape` verwirft. Eine neue
  Zeile (Aufgabe, Milestone, Gruppe), die leer bleibt oder abgebrochen wird, verschwindet spurlos
  (`discard`: Papierkorb und gleich endgültig gelöscht, kein Rückgängig-Eintrag). Ein geleertes
  Feld lässt bei bestehenden Zeilen den alten Titel stehen. `indent`/`outdent` liegen dafür jetzt
  in `actions.ts`.
- ~~Milestones und Gruppen lassen sich nicht ziehen; Aufgaben nicht auf die Reiter und nicht auf
  ein Projekt~~ **Erledigt** (`dnd.ts`, Regeln aus `dragover`/`applyDrop`). Aufgaben: über einer
  Aufgabe davor/hinein/danach, über Milestone, Gruppe und Platzhalter hinein („Liegt jetzt …“),
  auf „Plan“ nur der Hinweis, „Backlog“ wie `B`, „Doku“ und „Archiv“ mit den Meldungen des
  Prototyps, auf ein Projekt in dessen Backlog. Milestones: davor/danach (übernimmt Projekt und
  Planungsstand des Ziels), auf „Plan“, „Backlog“ und „Archiv“. Projekte und Gruppen (nur im
  eigenen Projekt) zum Sortieren. Die Hervorhebungen (`dz-before/after/child/on`) für Zeilen,
  Reiter und Seitenleiste sind aus dem Prototyp übernommen. Der Ziehzustand liegt in einem
  eigenen kleinen Speicher, weil Liste, Reiter und Seitenleiste beteiligt sind.
  Abweichung: Milestones, Gruppen und Projekte haben ganzzahlige Ordnungswerte; statt
  `order ± 0,5` wird die Liste neu durchgezählt und nur Geänderte gehen als Schritte in einer
  Transaktion zum Server (Rückgängig ohne Meldung, wie das stille Umsortieren im Prototyp).
- ~~**Neu, über den Prototyp hinaus (Wunsch des Nutzers):** Mehrfachauswahl ziehen~~ **Erledigt.**
  Zieht man eine ausgewählte Zeile, wandern alle obersten Ausgewählten mit und werden während des
  Ziehens blass; über einer von ihnen oder ihren Unteraufgaben gibt es keine Zone. Das läuft über
  `POST /api/bulk` (`move`), der jetzt `index` beachtet und die Auswahl als Block an die Stelle
  setzt (Test: `setzt verschobene Ausgewählte mit Platzangabe als Block an die Stelle`). Meldung
  „n Tasks verschoben“ bzw. „n Tasks liegen jetzt …“, mit Rückgängig.
- ~~Klick auf eine Gruppenzeile klappt im Prototyp auf/zu; Doppelklick auf den Gruppennamen benennt
  um.~~ **Erledigt.** Gilt für eigene Gruppen, „Unsortiert“ und smarte Gruppen; Knöpfe und das
  Namensfeld behalten ihre eigene Handlung, umbenennen lassen sich nur eigene Gruppen. Nebenbei:
  `Strg+A` griff auch in Eingabefeldern der Liste und wählte alle Aufgaben aus, statt den Text zu
  markieren – jetzt wie im Prototyp nur, wenn nicht getippt wird.
- ~~Zeichnungs-Abzeichen~~ **Erledigt.** Öffnet wie `openDraw` im Prototyp direkt die (erste)
  Zeichnung im Editor, an Aufgaben und Milestones, ohne die Auswahl zu ändern; Tooltip wie im
  Prototyp („Zeichnung „…“ öffnen“ bzw. „2 Zeichnungen: … – öffnet „…““). Der Editor dafür hängt
  global in der App (`BadgeDrawingEditor`) und holt die Szene selbst.
- ~~Status auf Englisch~~ **Erledigt** (Tooltip und Vorschau der Schnell-Erfassung).

**Tastatur**
- ~~Milestone-Tasten fehlen~~ **Erledigt.** `S` (Offen → In Progress → Done), `P` (Plan ↔ Backlog),
  `B` (in den Backlog, sonst „Liegt schon im Backlog“), `F2`/`E`, `Alt ↑/↓`. Wie im Prototyp
  (`item(u.sel)`) gelten die Tasten dem Ausgewählten auch, wenn es gerade aus der Ansicht gefallen
  ist – sonst holte `P` einen eben herausgenommenen Milestone nicht zurück.
- ~~`M` und `Kontextmenü`/`⇧ F10` fehlen~~ **Erledigt.** `M` öffnet unter der Zeile das Ortsmenü
  (`propMenu(x, 'loc')`: Behälter, „Unter einen Task“, „In anderes Projekt“), die Kontextmenü-Taste
  das Zeilenmenü; der Fokus steht jeweils auf dem ersten Eintrag.
- ~~`S`-Reihenfolge~~ **Erledigt:** Offen → In Progress → Erledigt. Bewusste Abweichung vom
  Prototyp auf Wunsch: Unklar und Blockiert sind Sonderstatus und werden nur ausdrücklich gesetzt;
  die Leertaste führt von dort zurück auf Offen. Später ebenfalls auf Wunsch: dieses Durchschalten
  liegt auf der **Leertaste** – `S` ist ersatzlos entfallen, und es gibt keine Taste mehr, die
  unmittelbar auf „erledigt“ setzt. Die Reihe läuft nicht im Kreis: bei Erledigt ist Schluss,
  zurück geht es mit **`Shift`+Leertaste**.
- ~~Leertaste auf Dokumentationsseiten~~ **Erledigt:** wirkt dort nicht.
- ~~`Esc` schließt immer~~ **Erledigt:** den Inspektor nur bis 1240 px Breite.
- ~~Menüs ohne Pfeiltasten~~ **Erledigt** (`ctxKey`): ↑/↓ reihum, → bzw. `Enter` öffnet ein
  Untermenü, ← schließt es, `Esc`/`Tab` schließt das Menü. Solange es offen ist, gehören ihm alle
  Tasten – vorher wanderte mit ↓ zugleich die Auswahl in der Liste. Per Tastatur geöffnete Knopf-
  Menüs (Inspektor, Mehrfachauswahl, „⋯“ am Projekt) setzen den Fokus ebenfalls hinein.
- Dabei gefunden und behoben: Die Listentasten griffen auch, wenn der Fokus auf einem Knopf in
  Seitenleiste oder Inspektor lag – `Enter` auf „⋯“ legte eine Aufgabe an, statt das Menü zu
  öffnen. Jetzt wie im Prototyp (`inList`) nur bei Fokus in der Liste oder auf der Seite selbst.
- Dabei gefunden und behoben: `Enter` auf einer Doku-Seite der obersten Ebene (und „Neue Seite
  darunter“) legte eine Backlog-Aufgabe an statt einer Seite.
- ~~Ein eingeplanter Milestone behält seinen Platz~~ **Erledigt:** `planMilestone` ist `planMs` –
  `P`, `B`, Menü, „In den Plan →“ und Ziehen auf die Reiter setzen ihn ans Ende der Zielliste,
  mit „Ist schon im Plan“/„Liegt schon im Backlog“ und „„…“ ist im Plan · fertig ca. …“ bzw. „ist
  zurück im Backlog“. `B` an einer Aufgabe meldet wie im Prototyp („liegt jetzt im Backlog ›
  Unsortiert“ oder „Liegt schon unter „Unsortiert““), `A` meldet „„…“ archiviert“ (am Milestone
  „– samt Tasks“).
- ~~„Anzeigen“ an diesen Meldungen~~ **Erledigt** (siehe „Meldungen und Hilfe“).
- ~~Meldung zu `S` am Milestone~~ **Erledigt** (mit dem Burnup). Wie `setMsStatus` im Prototyp
  laufen `S`, Inspektor, Menü, „Als Done markieren“ und „Alle Tasks erledigt – Done?“ über
  `setMilestoneStatus`: „In Progress“ setzt ein fehlendes Startdatum, „Done“ ein fehlendes
  Enddatum (`endAuto`), das beim Zurücksetzen wieder verschwindet. Meldung „◆ Alpha: In Progress ·
  Start 21.09.“ mit Rückgängig.

**Kopf und Seitenleiste**
- ~~Kopf-Knöpfe~~ **Erledigt.** Wie im Prototyp: „+ Milestone“ nur im Plan, legt den Milestone
  sofort an und öffnet den Titel zum Eintippen; „+ Seite“ nur in der Doku; „+ Aufgabe“ entfällt
  (Aufgaben entstehen über Schnellerfassung und Liste). Tooltips aus dem Prototyp übernommen.
- ~~Projektmenü~~ **Erledigt.** „⋯“ und Rechtsklick am Projekt öffnen `projMenu` (Einträge und
  Farbpalette 1:1 gegen den Prototyp verglichen); Doppelklick benennt in der Zeile um (Meldung mit
  „Rückgängig“), „Nach oben/unten“ tauscht die Reihenfolge in einem Schritt-Paar, „Kategorien
  verwalten …“ gilt dem gewählten Projekt (auch aus dem Kategorie-Menü einer Aufgabe), das letzte
  Projekt lässt sich nicht löschen.
  Dabei im Server gefunden: Ein gelöschtes Projekt nahm Kategorien, Gruppen und Milestones per
  Kaskade mit, ohne sie in den Papierkorb zu legen – Wiederherstellen scheiterte am
  Fremdschlüssel. Jetzt stecken sie samt Burnup-Verlauf und Milestone-Abhängigkeiten im Eintrag;
  Aufgaben werden beim Wiederherstellen Eltern-zuerst eingefügt (nach einem Verschieben kann ein
  Kind älter sein als sein Elternteil). Test: `ein gelöschtes Projekt kommt vollständig wieder`.
- ~~Projekte lassen sich nicht zum Sortieren ziehen~~ **Erledigt** (siehe Ziehen und Ablegen);
  die Projektzeile trägt den Titel des Prototyps.
- ~~„+ Neues Projekt“~~ **Erledigt.** Wie im Prototyp gleich ein gestricheltes Eingabefeld; Enter
  legt an und öffnet das Projekt im Backlog, leer passiert nichts. Maße und Rahmen gegen den
  Prototyp gemessen.
- ~~Filterleiste~~ **Erledigt.** „Gefiltert:“ vor den Chips, Label-Chip in seiner Farbe,
  Kategorie-Chip mit Farbfeld – Markup gegen den Prototyp verglichen.
- ~~Zähler in Doku und Archiv~~ **Erledigt.** Die Zahlen an Kategorien, Markierungen und Labels
  zeigen, was in der aktuellen Ansicht steht: in der Doku die Seiten, im Archiv das Archivierte
  (soweit geladen), im Zeitplan wie im Plan nur das Geplante. Plan und Backlog unverändert.

**Inspektor**
- ~~Inspektor für Dokumentationsseiten~~ **Erledigt.** Wie im Prototyp nur Kategorie, Markierung,
  Labels, Inhalt und Unterseiten – kein Status, Fortschritt, Priorität und keine Abhängigkeiten.
  Nebenbei: Im Pfad stand das Seiten-Symbol über „Dokumentation“; jetzt wie im Prototyp
  „📄 Dokumentation“ in einer Zeile.
- Der Inhalts-Editor übernimmt beim Verlassen des Feldes nicht (Prototyp: Fokus weg = fertig).
- Trefferliste der Abhängigkeiten nicht mit Pfeiltasten wählbar.
- ~~Zeichnungen lassen sich nicht löschen~~ **Erledigt** (vom Nutzer gemeldet). „Löschen“ sitzt
  wie im Prototyp in der Leiste des Zeichen-Editors, ohne Rückfrage. Der Server nimmt dabei
  `![[zeichnung:Name]]` aus der Beschreibung (Leerzeilen zusammengezogen wie im Prototyp) und legt
  die Zeichnung als Papierkorb-Eintrag der Art `drawing` ab; der erscheint nicht in der
  Papierkorb-Liste, dient nur „Rückgängig“ (`untrash` plus die alte Beschreibung) und läuft mit
  der üblichen Frist ab. Das nie aufgerufene `useDrawings().remove` ist weg. Test: `eine gelöschte
  Zeichnung verlässt die Beschreibung und kommt mit Rückgängig wieder`.

**Archiv und Papierkorb**
- ~~Archiv~~ **Erledigt** (`ui/archive.tsx`): Monatsüberschriften, Herkunft („aus dem Plan · 3
  Tasks“, „aus „Eltern““, „aus ◆ …“, „aus Backlog › …“, bei „Alle Projekte“ mit Projektname),
  Aufklappen bis in die Unteraufgaben (`archOpen` pro Gerät) mit „einzeln archiviert“, Auswahl mit
  Inspektor (bearbeitbar wie im Prototyp), ↩/✕ an der Zeile, Rechtsklick und `⇧F10` mit
  `archMenu`, Tasten ↑↓ `A` `Entf` ←→, Kopfleiste mit „Suche“ und Tastenhinweis. Der Server liefert
  dafür je Seite den ganzen Unterbaum mit (`loadArchive`: `tasks`, `milestones`); der Client baut
  daraus einen zweiten Arbeitsstand (`archiveWorkspace`) für Liste und Inspektor.
  - Zurückholen wie `restore` im Prototyp: Liegt der alte Ort selbst im Archiv, kommt die Aufgabe
    lose nach „Unsortiert“ („… (der ursprüngliche Ort ist archiviert)“); ein Milestone reiht sich
    hinten ein. Beim Rückgängigmachen eines Archivierens bleibt der alte Platz.
  - Doppelte Zeile: Einzeln Archiviertes steht als Eintrag und im aufgeklappten Baum darüber. Die
    React-Schlüssel tragen deshalb den Pfad, sonst verwechselte React die beiden Zeilen.
  - **Abweichung, bewusst:** Das Archiv kommt seitenweise (Abschnitt 4). Am Ende steht „n weitere
    laden“, der Prototyp zeigt immer alles.
- ~~Papierkorb~~ **Erledigt:** Kopfzeile mit Frist und „Papierkorb leeren“ (Rückfrage in der
  Leiste, leert nur, was die Ansicht zeigt), Herkunft (beim Löschen festgehalten, `where` im
  Eintrag), „inkl. n Unteraufgaben · n Zeichnungen“, „vor n Tagen · noch n Tage“, Symbol je Art
  (Punkt in Projektfarbe, ◆, ·). „Endgültig löschen“ und „Leeren“ haben Rückgängig (`unpurge`: der
  Client schickt die gelöschten Zeilen zurück). Sichtbar ist, was `trashInView` im Prototyp zeigt.
  - Wiederherstellen wie im Prototyp: ohne Projekt eine Meldung statt eines Fehlers, fehlende
    Eltern → lose in den Backlog, ein Milestone holt die losgelassenen Aufgaben zurück und reiht
    sich hinten ein. Meldung „„Titel“ wiederhergestellt unter „…““ bzw. „im Archiv“.
  - **Behoben:** Ein archivierter Milestone ließ beim Löschen seine Aufgaben zurück – sie tauchten
    im Backlog wieder auf. Wie im Prototyp gehen sie jetzt mit in den Papierkorb.
- Nebenbei: Rückgängig, `Escape` und `N`/`/` gelten jetzt in jeder Ansicht (`useGlobalKeys`),
  vorher nur in Plan, Backlog und Doku. `.eta` ist wie im Prototyp in Mono gesetzt (auch im Plan).
  Archiv und Papierkorb laden nach jeder Änderung mit, statt leer stehen zu bleiben.
- ~~„Anzeigen“/„Öffnen“ nach dem Zurückholen~~ **Erledigt** (siehe „Meldungen und Hilfe“).
  Ziehen auf den Reiter „Archiv“ ist mit Drag & Drop erledigt.

**Aus den Notizen des Nutzers (zusätzlich)**
- ~~Enter legt doppelt an~~ **Erledigt.** Bei allen `NewThing`-Feldern (Projekt, auch beim ersten
  Projekt, Milestone, Gruppe): `Enter` rief `commit`, `busy` sperrte das Feld, das gesperrte Feld
  verlor den Fokus, `onBlur` rief `commit` ein zweites Mal. Jetzt sperrt ein Ref den zweiten Aufruf.
- ~~Aufgaben der obersten Ebene lassen sich nicht zuklappen~~ **Erledigt** mit der Tiefe (0 → 1):
  Der Pfeil lag unter der absolut liegenden Prioritätsspalte, die den Klick abfing.
- ~~Ein Projekt lässt sich nicht löschen~~ **Erledigt** mit dem Projektmenü (siehe Kopf und
  Seitenleiste).

**Meldungen und Hilfe**
- ~~Meldungen mit „Anzeigen“~~ **Erledigt.** Wie im Prototyp: „In den Plan“ / „zurück im
  Backlog“, Wiederherstellen aus Archiv und Papierkorb sowie Anlegen per Schnellerfassung außerhalb
  der Sicht bieten „Anzeigen“; ein wiederhergestelltes Projekt „Öffnen“. „Anzeigen“ ist ein Port
  von `goto`/`reveal`: Projekt und Ansicht wechseln, Behälter aufklappen, Filter weg, wenn er die
  Aufgabe verstecken würde, auswählen; Archiviertes öffnet das Archiv. Die Schnellerfassung klappt
  wie `expandTo` den Behälter der neuen Aufgabe auf. Am Planen/Zurücklegen steht dafür jetzt
  „Anzeigen“ statt „Rückgängig“ (wie im Prototyp; `Strg+Z` geht weiter).
  Nach der Schnellerfassung heißt die Meldung wie im Prototyp „Angelegt im Backlog › … · Projekt“
  (`whereLabel`); ist die neue Zeile zu sehen, bietet sie „Rückgängig“. Abweichung: Das
  Zurücknehmen legt die Aufgabe in den Papierkorb, im Prototyp verschwindet sie ganz.
- ~~„+ Milestone“ / „+ Gruppe“ in den Backlog-Abschnitten~~ **Erledigt.** Wie `addMilestone` und
  `addGroup` im Prototyp: sofort anlegen, Name in der neuen Zeile; leer oder Escape entfernt sie
  wieder.
- Neue Zeichnungen heißen „Zeichnung“ statt „Skizze n“ – so gewollt (Entscheidung des Nutzers).
- ~~Die Kürzel-Hilfe ist gekürzt~~ **Erledigt.** Vollständig wie im Prototyp (Text Zeile für Zeile
  verglichen, Knopf „Schließen“). Zwei gewollte Abweichungen: `S` nennt den Ablauf Offen → In
  Progress → Erledigt (Unklar/Blockiert nur ausdrücklich, auf Wunsch), und die Zeile „Zeichnung“
  beschreibt „+ Zeichnung“ und Excalidraw, wo „Fertig“ statt `Esc` schließt.
- ~~**Backlog.**~~ **Erledigt.** Die drei Abschnitte des Prototyps: „Vorbereitete Milestones“ (die
  nicht eingeplanten, mit „In den Plan →“ und eigenem „+ Milestone“), „Ideen & Tasks“ (Unsortiert
  plus die eigenen Gruppen, mit „+ Gruppe“) und „Smarte Gruppen“ – eine je Markierung. Der Plan
  zeigt jetzt nur noch eingeplante Milestones. Leere Behälter bekommen den gestrichelten
  Platzhalter zum Hineinziehen, Gruppen lassen sich in der Zeile umbenennen und löschen, und
  Milestone-Titel sind ebenfalls direkt in der Zeile änderbar.

  Eine **smarte Gruppe** ist hier abgeleitet: sie besteht aus den losen Wurzelaufgaben mit genau
  dieser Markierung, statt wie im Prototyp eine eigene Ablage zu sein. Die Regeln bleiben gleich –
  hinein setzt die Markierung, heraus in den Backlog nimmt sie weg, heraus in einen Milestone lässt
  sie stehen. Unterschied nur im Randfall: eine markierte Aufgabe, die aus einem Milestone nach
  „Unsortiert“ gezogen wird, landet hier in ihrer smarten Gruppe statt unter „Unsortiert“.

  Dazu am Server: `POST /api/move` kennt jetzt `markId` (nur für lose Wurzeln) und `projectId`
  (weil Unsortiert und smarte Gruppen keinen Behälter mit eigenem Projekt haben), und die
  Neunummerierung zählt Unsortiert, Dokumentation und jede smarte Gruppe getrennt. Außerdem nehmen
  **Milestone und Gruppe ihre Aufgaben nicht mehr mit in den Papierkorb** – wie im Prototyp sind sie
  eine Ablage, kein Besitzer; die Aufgaben liegen danach unter „Unsortiert“.

  **Abweichung vom Prototyp (Wunsch des Nutzers) – Reiter „Ready“:** zwischen Plan und Backlog
  steht ein Reiter für fertig vorbereitete Aufgaben. Er zeigt dieselben vorbereiteten Milestones
  wie der Backlog, dann „Smarte Gruppen (Kategorien)“ – eine je Kategorie des Projekts plus „Ohne
  Kategorie“ – und „Smarte Gruppen (Markierungen)“. Der Backlog kennt keine smarten Gruppen mehr.
  Ob eine lose Wurzel dort steht, entscheidet ein eigenes Kennzeichen `ready` (Spalte `task.ready`,
  Migration `0007_ready`), nicht Kategorie oder Markierung – beide darf eine Aufgabe schon im
  Backlog haben; dort steht sie dann unter „Unsortiert“ oder in einer eigenen Gruppe. In „Ready“
  gewinnt die Markierung vor der Kategorie. Hineinziehen in eine Gruppe von „Ready“ setzt `ready`
  und ihre Markierung beziehungsweise Kategorie (eine Kategorie-Gruppe nimmt die Markierung weg);
  zurück in den Backlog nimmt nur `ready` weg. In Milestone, eigene Gruppe oder unter eine Aufgabe
  verliert eine Aufgabe `ready`. Die Migration setzt `ready` bei allem, was bis dahin in einer
  smarten Gruppe stand.
- ~~**Zeitplan.**~~ **Erledigt.** Der eigene Reiter mit Hinweistext, Wochenachse (KW-Beschriftung,
  Schrittweite nach Spannweite), einer Zeile je eingeplantem Milestone und dem Balken aus dem
  Prototyp: blasser Vorlauf bei einem Startdatum in der Vergangenheit, schraffierter Überhang über
  ein zu knappes Enddatum, „✓ Done“ beziehungsweise „keine offenen Aufgaben“ statt eines Balkens.
  Gerechnet wird immer über alle Projekte, der Projektfilter wählt nur die sichtbaren Zeilen aus.
  **Abweichung vom Prototyp (Wunsch des Nutzers):** jedes Projekt hat seine eigene Reihe, Projekte
  verschieben sich nicht gegenseitig; nur eine ausdrücklich gesetzte Milestone- oder
  Task-Abhängigkeit wirkt über die Projektgrenze.
  Das Tempo steht wie im Prototyp allein über dieser Ansicht – aus dem Plan ist es dorthin
  gewandert. Dabei ist auch die Reihenfolge im Kopf geradegezogen: die Schnellerfassung steht jetzt
  wie im Prototyp über der Filterleiste und in jeder Ansicht, nicht nur in Plan, Backlog und Doku.

  Nicht übernommen: das Feld „ungeschätzt“ in der Unterzeile – im Prototyp ist es ein Rest aus dem
  Punktemodell und immer 0.
- ~~**Mehrfachauswahl.**~~ **Erledigt.** Strg-Klick wählt einzeln dazu, Umschalt-Klick den Bereich,
  Umschalt plus Pfeiltaste erweitert, Strg+A nimmt alles Sichtbare, Escape hebt auf. Ausgewählte
  Zeilen sind hinterlegt und stoßen als Block zusammen. Unten schwebt die Leiste des Prototyps mit
  Status, Priorität, Kategorie, Markierung, Labels, Verschieben, Archivieren und Papierkorb;
  derselbe Satz liegt als Kontextmenü auf dem Rechtsklick einer ausgewählten Zeile, und die
  Kürzel `A` und `Entf` wirken auf die ganze Auswahl. Bei mehr als einer Auswahl zeigt der
  Inspektor die Karten aus dem Prototyp – Titel, Status, Markierung, Ort und die Beschreibung zum
  Anklicken und Bearbeiten.

  Dafür neu: **`POST /api/bulk`** aus der API-Liste. Ein Aufruf, eine Transaktion – entweder alle
  oder keine. Jede Aufgabe schickt ihre `version` mit; passt eine nicht, bleibt der ganze Stapel
  liegen und der Client lädt neu. Verschieben, Archivieren und Löschen wirken nur auf die obersten
  Ausgewählten, weil Unteraufgaben ohnehin mitgehen (`topSelected` im Prototyp). `POST /api/move`
  kennt außerdem jetzt `doc`, sonst gäbe es keinen Weg in die Dokumentation und wieder heraus.
- ~~**Erledigte archivieren.**~~ **Erledigt.** Der Knopf „Erledigte archivieren (n)“ steht in Plan
  und Backlog neben den Reitern und verschwindet, wenn es nichts Erledigtes gibt. Was er mitnimmt,
  rechnet `doneCandidates` aus – dieselbe Aufteilung wie im Prototyp: im Plan die eingeplanten
  Milestones auf „Done“ und die erledigten Aufgaben darin, im Backlog die vorbereiteten Milestones
  und alles Lose. Aufgaben eines mitgenommenen Milestones zählen nicht doppelt, Dokumentationsseiten
  bleiben außen vor.
- ~~**Undo.**~~ **Erledigt.** Der Stapel liegt wie geplant im Tab (25 Schritte tief), der Server
  führt keinen Verlauf. Stattdessen liefert jede schreibende Handlung die **Gegen-Schritte** gleich
  mit; „Rückgängig“ schickt sie an `POST /api/steps` zurück, wo sie in einer Transaktion und in
  umgekehrter Reihenfolge laufen. Jeder `patch`- und `move`-Schritt nennt die Version, die nach der
  Handlung galt – hat sich inzwischen etwas geändert, wird die **ganze** Rücknahme abgelehnt statt
  halb ausgeführt. Ausgelöst wird sie über den Knopf in der Kurzmeldung oder mit Strg+Z.

  Abgedeckt sind Ändern, Verschieben, Archivieren, Papierkorb, alle Stapel-Aktionen und „Erledigte
  archivieren“. **Nicht abgedeckt: das Anlegen** – ein neu angelegter Eintrag lässt sich nicht
  wegnehmen, und aus dem Papierkorb Geholtes nicht wieder hineinlegen (es bekommt neue Zeilen, ein
  sauberes Gegenstück gibt es dafür nicht). Im Prototyp geht beides, weil er den ganzen Zustand
  sichert.

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
