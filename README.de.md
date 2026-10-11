# PDF-Stift

**PDFs mit Stift, Maus und Tastatur beschriften. Frei und quelloffen für Windows, Linux und Android.**

PDF-Stift ist ein PDF-Programm zum Lesen, Beschriften und Ordnen von Unterlagen wie Vorlesungsfolien, Aufsätzen und Scans. Sie schreiben mit dem Stift auf die Seiten, markieren Text, setzen Kommentare und Textfelder und durchsuchen den Text Ihrer ganzen Bibliothek. Notizen werden automatisch gespeichert und in die PDF geschrieben, sodass auch jedes andere PDF-Programm sie zeigt.

Alles bleibt auf Ihrem Gerät. Unter Windows und Linux braucht PDF-Stift kein Konto, keine Cloud und keinen Server und schickt keine Nutzungsdaten. Die Bibliothek ist ein ganz normaler Ordner (`Dokumente/PDF-Stift`). Auf Android wählen Sie: **Offline** (alles bleibt auf dem Tablet) oder **Online** mit [eigenem Server](docs/SERVER.md) – dann ist dieselbe Bibliothek in jedem Browser und auf dem Tablet da.

**[⬇ Herunterladen](https://github.com/ek1-wq/pdf-stift/releases/latest)** – Windows (`.exe`), Linux (`.AppImage`, `.deb`), Android (`.apk`), Server-Paket (`.zip`) · [English](README.md)

![Handschriftliche Notizen auf einer Vorlesungsfolie](docs/screenshots/hero.png)

![Folien im Notizbuch, mit Textbausteinen und Folienmarken](docs/screenshots/notebook.png)

![Folien links, Notizseite rechts – Folien einfach hinüberziehen](docs/screenshots/split.png)

## Was PDF-Stift kann

- **Schreiben und markieren.** Stift, Marker, Text markieren, unterstreichen und durchstreichen, Formen, Textfelder, Notizzettel, Lasso, Radierer und ein Laserpointer für Präsentationen. Drucksensitive Stifte funktionieren auf Touchscreens und Grafiktabletts.
- **Notizen werden Teil der PDF.** Sie werden beim Schreiben gespeichert und beim Schließen fest in die Datei geschrieben. Frühere Fassungen bleiben erhalten.
- **Volltextsuche** in allen PDFs auf einmal. Scans werden mit der in Windows eingebauten Texterkennung durchsuchbar.
- **Werkzeuge.** Seiten organisieren (umsortieren, drehen, löschen, herausziehen, aufteilen), PDFs zusammenfügen, Text und Bilder bearbeiten, Kopf- und Fußzeile, Seitenzahlen und Wasserzeichen, Lesezeichen, Stempel, Formulare ausfüllen und unterschreiben, Formularfelder anlegen, Fassungen vergleichen, schwärzen, mit Passwort schützen, nach Word, Excel, PowerPoint oder als Bilder exportieren und Handzettel mit 2–9 Folien pro Seite drucken.
- **Scans aufbereiten.** Schiefe Seiten gerade richten, leere Seiten entfernen und den Kontrast verstärken.
- **Passt zu Windows.** PDFs aus dem Explorer öffnen („In PDF-Stift öffnen“, „Senden an“), Word-, PowerPoint- und Excel-Dateien hineinziehen (umgewandelt mit Ihrem installierten Microsoft Office), aus jedem Programm auf den Drucker „PDF-Stift“ drucken, einen Ordner überwachen lassen und PDFs in den Explorer oder in eine E-Mail herausziehen.
- **Notizbuch.** Seiten mit unendlicher Fläche, geordnet in Notizbüchern und Abschnitten. Folien samt Notizen mit einem Klick oder per Ziehen übernehmen, Seitenvorlagen (Cornell, Besprechung, Vorlesung), Suche in getipptem Text und übernommenen Folien, Verknüpfungen zwischen Notizen und PDFs, frühere Stände wiederherstellen, als PDF speichern oder drucken (auf A4 verteilt).
- **Zwei Dokumente nebeneinander.** Folien links, Notizbuch oder eine zweite PDF rechts – mit einer gemeinsamen Werkzeugleiste.
- **Präsentieren.** Referentenansicht für Beamer und Videokonferenz: Folie auf der Leinwand, nächste Folie, Stoppuhr und Sprechernotizen bei Ihnen.
- **Deutsch und Englisch.** Umschalten unter Einstellungen → Sprache.

## Installieren

### Windows

1. Laden Sie `PDF-Stift-Setup-….exe` aus der [neuesten Version](https://github.com/ek1-wq/pdf-stift/releases/latest) herunter.
2. Starten Sie die Datei. Das Installationsprogramm ist noch nicht signiert. Windows SmartScreen meldet deshalb eventuell „Der Computer wurde durch Windows geschützt“. Klicken Sie dann auf **Weitere Informationen → Trotzdem ausführen**.
3. Starten Sie PDF-Stift. Die Oberfläche ist zunächst englisch. Unter **Settings → Language** stellen Sie Deutsch ein.

Updates kommen automatisch: Gibt es eine neue Version, erscheint oben rechts der blaue Knopf **Update verfügbar**. Darauf klicken, dann **Installieren**. Sie können auch über Hilfe → Nach Updates suchen nachsehen.

Voraussetzungen: Windows 10 oder 11 (64 Bit). Für das Umwandeln von Office-Dateien braucht es Microsoft Office, alles andere funktioniert auch ohne.

### Linux

`PDF-Stift-….AppImage` herunterladen, ausführbar machen und starten (`chmod +x PDF-Stift-*.AppImage && ./PDF-Stift-*.AppImage`) oder das `.deb`-Paket unter Debian/Ubuntu installieren (`sudo apt install ./pdf-stift_…_amd64.deb`). PHP ist eingebaut, sonst muss nichts installiert werden. Texterkennung für Scans und Office-Umwandlung gibt es vorerst nur unter Windows.

### Android

`PDF-Stift-….apk` auf dem Tablet herunterladen und öffnen (Android fragt einmal, ob Apps aus dieser Quelle installiert werden dürfen). Beim ersten Start **Offline** oder **Online** mit der Adresse des eigenen Servers wählen. Neue Versionen meldet die App mit einem blauen **Update**-Knopf.

### Eigener Server

Server-Paket per FTP auf den eigenen Webspace laden und PDF-Stift in jedem Browser und mit der Android-App nutzen – siehe **[docs/SERVER.md](docs/SERVER.md)** (ca. 10 Minuten, jeder Hoster mit PHP 8.1).

## Lizenz

PDF-Stift ist freie Software unter der **GNU General Public License, Version 3** ([LICENSE](LICENSE)), ohne jede Gewährleistung. Mitgelieferte Fremdbausteine behalten ihre eigenen Lizenzen, siehe [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Technische Einzelheiten, Bauanleitung und Hinweise zum Mitmachen stehen in der [englischen Beschreibung](README.md).

© PDF-Stift contributors
