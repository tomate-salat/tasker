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
- `POST /api/kind/:kind` – anlegen
- `PATCH /api/kind/:kind/:id` – ändern, mit `version` des Standes, auf dem die Änderung basiert
- `DELETE /api/kind/:kind/:id` – in den Papierkorb
- `POST /api/kind/:kind/:id/archive` bzw. `/restore` – archivieren und zurückholen
- `POST /api/move` – Drag & Drop: neuer Elternteil / Milestone / Gruppe plus Platz (`index`), als eine Transaktion
- `GET|POST /api/drawings`, `PATCH|DELETE /api/drawings/:id` – Zeichnungen (siehe Abschnitt 7, Schritt 8)

Die Objektrouten liegen bewusst unter dem Präfix `/kind`, damit sie sich mit festen Pfaden wie
`/move`, `/trash` oder `/settings` nicht überschneiden können. Sonst hinge die Korrektheit an der
Reihenfolge, in der die Routen registriert werden, und kippte beim nächsten eingefügten Endpunkt.
- `POST /api/bulk` – Mehrfachauswahl als eine Transaktion
- `POST /api/duplicate` – eine Aufgabe samt Unterbaum, Labels und Abhängigkeiten kopieren
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
     ein und aus, `Alt+↑/↓` sortieren um, `Leertaste` erledigt, `e`/`F2` bearbeitet den Titel in der
     Zeile, `s` schaltet den Status weiter, `a` archiviert, `Entf` legt in den Papierkorb, `n`
     oder `/` springt in die Erfassungszeile.
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
11. Gamification, dezent.

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

  **Abweichung, auf Wunsch – Zählweise:** Im Prototyp zählt eine Sammel-Aufgabe nur ihre
  Unteraufgaben (eine erledigte Aufgabe mit einer erledigten Unteraufgabe war 1 von 1). Hier
  zählt jede Aufgabe, die Sammel-Aufgabe selbst eingeschlossen (`total` in
  `src/shared/progress.ts`), und zwar überall: Burnup, „x/y“ am Milestone, Balken und
  Segmente, Prognose und Zeitplan, offene Aufgaben in der Seitenleiste. Nur das „x/y“ an einer
  Aufgabe (Zeile und Aufgabenlisten im Inspektor) zählt ihre Unteraufgaben ohne sie selbst
  (`subtaskCounts`) – eine erledigte Aufgabe mit einer erledigten Unteraufgabe zeigt 1/1. Eine offene
  Sammel-Aufgabe mit lauter erledigten Unteraufgaben steht damit nicht mehr auf 100 %. Die
  bis dahin geschriebenen Burnup-Protokolle leert Migration `0004_burnup_neu_zaehlen`; sie
  werden aus den Abschlusszeitpunkten neu aufgebaut. Der Paritätstest vergleicht Zahlen nur noch
  dort mit dem Prototyp, wo keine Sammel-Aufgabe im Spiel ist.

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
  Menü als Funktion), „Neues Label …“ springt ins Labelfeld des Inspektors. „+ Label“ erscheint
  beim Überfahren leerer Zeilen. Zellmaße gegen den Prototyp gemessen: deckungsgleich.
- ~~Titel bearbeiten~~ **Erledigt.** `Enter` bestätigt und legt die nächste Aufgabe an, `⇧ Enter`
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
- Das Zeichnungs-Abzeichen öffnet im Prototyp direkt die Zeichnung, hier nur die Aufgabe.
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
  `S` führt von dort zurück auf Offen.
- ~~Leertaste und `S` auf Dokumentationsseiten~~ **Erledigt:** wirken dort nicht mehr.
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
- Offen: „Anzeigen“ an diesen Meldungen – gehört zu „Meldungen und Hilfe“.
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
- „+ Neues Projekt“ ist im Prototyp ein gestricheltes Eingabefeld, hier ein Knopf, der erst zum
  Feld wird.
- ~~Filterleiste~~ **Erledigt.** „Gefiltert:“ vor den Chips, Label-Chip in seiner Farbe,
  Kategorie-Chip mit Farbfeld – Markup gegen den Prototyp verglichen.
- ~~Zähler in Doku und Archiv~~ **Erledigt.** Die Zahlen an Kategorien, Markierungen und Labels
  zeigen, was in der aktuellen Ansicht steht: in der Doku die Seiten, im Archiv das Archivierte
  (soweit geladen). Plan und Backlog unverändert.

**Inspektor**
- Dokumentationsseiten zeigen Status, Fortschritt, Priorität und Abhängigkeiten; im Prototyp nur
  Kategorie, Markierung und Labels.
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
- Offen: Die Meldungen nach dem Zurückholen haben noch kein „Anzeigen“ bzw. „Öffnen“ (gehört zu
  „Meldungen und Hilfe“). Ziehen auf den Reiter „Archiv“ ist mit Drag & Drop erledigt.

**Aus den Notizen des Nutzers (zusätzlich)**
- ~~Enter legt doppelt an~~ **Erledigt.** Bei allen `NewThing`-Feldern (Projekt, auch beim ersten
  Projekt, Milestone, Gruppe): `Enter` rief `commit`, `busy` sperrte das Feld, das gesperrte Feld
  verlor den Fokus, `onBlur` rief `commit` ein zweites Mal. Jetzt sperrt ein Ref den zweiten Aufruf.
- ~~Aufgaben der obersten Ebene lassen sich nicht zuklappen~~ **Erledigt** mit der Tiefe (0 → 1):
  Der Pfeil lag unter der absolut liegenden Prioritätsspalte, die den Klick abfing.
- ~~Ein Projekt lässt sich nicht löschen~~ **Erledigt** mit dem Projektmenü (siehe Kopf und
  Seitenleiste).

**Meldungen und Hilfe**
- Meldungen mit „Anzeigen“ (nach Anlegen außerhalb der Sicht, Wiederherstellen, In den Plan) fehlen.
- Die Kürzel-Hilfe ist gekürzt – sie spiegelt die fehlenden Funktionen oben.
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
- ~~**Zeitplan.**~~ **Erledigt.** Der eigene Reiter mit Hinweistext, Wochenachse (KW-Beschriftung,
  Schrittweite nach Spannweite), einer Zeile je eingeplantem Milestone und dem Balken aus dem
  Prototyp: blasser Vorlauf bei einem Startdatum in der Vergangenheit, schraffierter Überhang über
  ein zu knappes Enddatum, „✓ Done“ beziehungsweise „keine offenen Aufgaben“ statt eines Balkens.
  Gerechnet wird immer projektübergreifend, der Projektfilter wählt nur die sichtbaren Zeilen aus.
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
