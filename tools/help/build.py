#!/usr/bin/env python3
"""Kurzanleitung als PDF im APA-Stil (7. Auflage) erzeugen.

Je Sprache (de, en) und Ausgabe (server = Browser/Windows-App mit eigenem Server und Tablet,
local = Windows-/Linux-App ohne Server) entsteht eine Datei in server/hilfe/:
    kurzanleitung-server.de.pdf, kurzanleitung-local.de.pdf, kurzanleitung-server.en.pdf, kurzanleitung-local.en.pdf

Aufruf:  python3 tools/help/build.py
Benötigt reportlab; Schrift: Carlito (metrisch gleich Calibri, SIL OFL) aus server/vendor/fonts.

APA 7 (Studierenden-Arbeit): Titelseite, Seitenzahl oben rechts, 2,54 cm Ränder, Calibri 11 pt,
doppelter Zeilenabstand, Absätze mit 1,27 cm Einzug, Überschriften Ebene 1 zentriert fett,
Ebene 2 linksbündig fett, Tabellen mit Nummer (fett), kursivem Titel und nur waagrechten Linien.
"""
import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, KeepTogether, ListFlowable, ListItem, CondPageBreak)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONTS = os.path.join(ROOT, 'server' if os.path.isdir(os.path.join(ROOT, 'server')) else 'app', 'vendor', 'fonts')
OUT = os.path.join(ROOT, 'server' if os.path.isdir(os.path.join(ROOT, 'server')) else 'app', 'hilfe')

for n, f in (('C', 'Carlito-Regular.ttf'), ('C-B', 'Carlito-Bold.ttf'), ('C-I', 'Carlito-Italic.ttf'), ('C-BI', 'Carlito-BoldItalic.ttf')):
    pdfmetrics.registerFont(TTFont(n, os.path.join(FONTS, f)))
pdfmetrics.registerFontFamily('C', normal='C', bold='C-B', italic='C-I', boldItalic='C-BI')

FS = 11            # Calibri 11 pt
LEAD = 26.4        # doppelter Zeilenabstand (wie „doppelt“ in Word bei Calibri 11)
MARGIN = 2.54 * cm
INDENT = 1.27 * cm

body = ParagraphStyle('body', fontName='C', fontSize=FS, leading=LEAD, firstLineIndent=INDENT, alignment=TA_LEFT)
plain = ParagraphStyle('plain', parent=body, firstLineIndent=0)
center = ParagraphStyle('center', parent=plain, alignment=TA_CENTER)
title_s = ParagraphStyle('title', parent=center, fontName='C-B')
h1 = ParagraphStyle('h1', parent=center, fontName='C-B', spaceBefore=0, keepWithNext=1)
h2 = ParagraphStyle('h2', parent=plain, fontName='C-B', keepWithNext=1)
item = ParagraphStyle('item', parent=plain)
tnum = ParagraphStyle('tnum', parent=plain, fontName='C-B', keepWithNext=1)
ttitle = ParagraphStyle('ttitle', parent=plain, fontName='C-I', keepWithNext=1)
tcell = ParagraphStyle('tcell', fontName='C', fontSize=FS, leading=FS * 1.25)
thead = ParagraphStyle('thead', parent=tcell, fontName='C-B')
tnote = ParagraphStyle('tnote', parent=plain)


def keys(s):
    """Tasten hervorheben: Strg+O → <b>Strg</b>+<b>O</b> (nur fett, ohne Kästchen – wie in APA-Texten üblich)."""
    return '+'.join(f'<b>{k}</b>' for k in s.split('+'))


# ------------------------------------------------------------------------------------------------
# Inhalt. Jeder Eintrag: (Art, Inhalt[, Ausgabe]) – Ausgabe 'S' nur Server/Tablet, 'L' nur lokale App
# Arten: h1, h2, p (Absatz mit Einzug), ul (Aufzählung), table (Nummer wird gezählt)
# ------------------------------------------------------------------------------------------------
DE = {
    'title': 'PDF-Stift: Kurzanleitung',
    'titlepage': {
        'S': ['PDF-Stift', 'Kurzanleitung für den Browser, die Windows-App und das Tablet', 'Stand: Oktober 2026'],
        'L': ['PDF-Stift', 'Kurzanleitung für die Windows- und die Linux-App', 'Stand: Oktober 2026'],
    },
    'table': 'Tabelle',
    'note': 'Anmerkung.',
    'blocks': [
        ('p', 'PDF-Stift ist ein Programm zum Lesen, Beschriften und Ordnen von PDF-Dateien wie Vorlesungsfolien, Aufsätzen und Scans. '
              'Außerdem lassen sich damit Notizbücher führen und Präsentationen gestalten oder aus PowerPoint übernehmen. '
              'Diese Kurzanleitung zeigt, was es gibt und wo es zu finden ist.'),
        ('p', 'Die Angaben „PC“ und „Tablet“ kennzeichnen, wo eine Funktion zur Verfügung steht: „PC“ meint die Windows-App und den Browser, '
              '„Tablet“ die Android-App. Menüangaben beziehen sich auf die Windows-App; im Browser steht fast alles im Menü „Mehr“ '
              '(drei Punkte oben rechts).', 'S'),
        ('p', 'Diese Ausgabe läuft ganz auf Ihrem PC. Sie braucht kein Konto und keinen Server, und Ihre PDFs bleiben als normale Dateien '
              'in einem Ordner auf Ihrem Rechner.', 'L'),

        ('h1', 'Die Oberfläche'),
        ('p', 'Ganz oben stehen die Reiter der geöffneten Dokumente. Rechts daneben liegen die Knöpfe <b>Seiten</b>, <b>Kommentare</b>, '
              '<b>Werkzeuge</b> und <b>Präsentation</b>, der Umschalter für helles und dunkles Design sowie die Anzeige „Gespeichert“.'),
        ('p', 'Darunter folgt das Menüband mit den Reitern Datei, Start, Einfügen, Zeichnen, Seiten, Bildschirmpräsentation, Ansicht und Hilfe – '
              'geordnet wie in Office-Programmen. Ein Doppelklick auf einen Reiter oder ' + keys('Strg+F1') + ' klappt das Menüband ein und wieder aus. '
              'Die klassische Menüleiste mit allen Befehlen erscheint in der Windows-App mit der Taste ' + keys('Alt') + '.'),
        ('p', 'Unter dem Menüband liegen die Stiftleiste (Lieblingsstifte, Rückgängig, Zoom) und die Werkzeugleiste (Werkzeuge, Farben und '
              'Strichstärken) mit der Symbolleiste. Jede Leiste lässt sich am Griff links an einen beliebigen Fensterrand ziehen. '
              '<b>Ansicht → Standardanordnung</b> stellt alles zurück; <b>Ansicht → Kompakt (nur Menüband)</b> blendet die Werkzeugleiste aus.'),

        ('h1', 'Öffnen und Bibliothek'),
        ('p', 'Die Bibliothek hat drei Bereiche: <b>Meine PDFs</b>, <b>Notizbuch</b> und <b>Präsentationen</b>. Ein Antippen öffnet ein Dokument in einem eigenen Reiter.'),
        ('ul', [
            ('PDF öffnen: in der Bibliothek antippen oder ' + keys('Strg+O') + ' (lädt eine Datei hoch).', 'S'),
            ('PDF öffnen: in der Bibliothek antippen oder ' + keys('Strg+O') + '.', 'L'),
            ('Bibliotheksordner: Ihre PDFs liegen als normale Dateien in <b>Dokumente\\PDF-Stift</b>. Öffnen: Hilfe → Bibliotheksordner öffnen; '
             'ändern: Hilfe → Bibliotheksordner ändern (oder Einstellungen → Bibliothek).', 'L'),
            'Hineinziehen aus dem Explorer – auch Word-, PowerPoint- und Excel-Dateien, die dabei zur PDF werden (PC).',
            'Rechtsklick im Explorer → „In PDF-Stift öffnen“ (unter Windows 11 zuerst „Weitere Optionen anzeigen“) oder „Senden an → PDF-Stift“ (PC).',
            'Drucken aus Word, Chrome oder Outlook auf den Drucker „PDF-Stift“; einmal einrichten über Datei → Als Drucker einrichten (PC).',
            'Überwachter Ordner: Alles, was dort hineinkommt, wird automatisch übernommen (Datei → Einstellungen; PC).',
            'Zuletzt geöffnet: Rechtsklick auf das PDF-Stift-Symbol in der Taskleiste (PC).',
            ('Aus anderen Apps: Teilen → PDF-Stift (Tablet).', 'S'),
        ]),

        ('h1', 'Schreiben und Markieren'),
        ('p', 'Stift, Marker, Text markieren, Formen, Textfeld, Lasso und Radierer stehen in der Werkzeugleiste und im Menüband unter „Start“ und „Zeichnen“. '
              'Notizen werden sofort gespeichert und zwischen PC und Tablet abgeglichen.', 'S'),
        ('p', 'Stift, Marker, Text markieren, Formen, Textfeld, Lasso und Radierer stehen in der Werkzeugleiste und im Menüband unter „Start“ und „Zeichnen“. '
              'Notizen werden sofort gespeichert – direkt im Bibliotheksordner auf Ihrem PC.', 'L'),
        ('table', 'Tasten für die Werkzeuge', ['Taste', 'Werkzeug'], [
            ['V', 'Text auswählen'], ['H', 'Hand (verschieben)'], ['P', 'Stift'], ['M', 'Marker (frei)'], ['U', 'Text markieren'],
            ['T', 'Textfeld'], ['E', 'Radierer'], ['Leertaste gedrückt halten', 'vorübergehend Hand; die mittlere Maustaste ebenso'],
            ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'],
        ], 'Die Tasten gelten am PC. Ein Rechtsklick auf markierten Text bietet Hervorheben, Unterstreichen, Durchstreichen und Kopieren an.'),

        ('h1', 'Kommentare'),
        ('ul', [
            'Werkzeug „Kommentar“ wählen, auf die Seite tippen, schreiben und „Fertig“ wählen.',
            'Einen Zettel antippen, um ihn zu lesen, zu ändern oder zu löschen.',
            'Alle Kommentare als Liste: Knopf „Kommentare“ oben (PC).',
            ('Auf dem Tablet: Menü (drei Punkte) → Kommentare (Liste).', 'S'),
            'Beim Speichern und Weitergeben werden sie zu echten PDF-Kommentaren, die auch andere PDF-Programme zeigen.',
        ]),

        ('h1', 'Ansicht und Navigation'),
        ('table', 'Tastenkürzel für Ansicht und Navigation', ['Tasten', 'Wirkung'], [
            ['Strg+0', 'ganze Seite'], ['Strg+1', 'Originalgröße (100 %)'], ['Strg+2', 'Seitenbreite'],
            ['Strg+Plus / Strg+Minus', 'vergrößern / verkleinern'],
            ['Strg+Umschalt+R / Strg+Umschalt+L', 'Ansicht rechts / links drehen (die PDF bleibt unverändert)'],
            ['Strg+Umschalt+D', 'zwei Dokumente nebeneinander'],
            ['Strg+H', 'Leisten ausblenden'], ['F11', 'Vollbild'],
            ['Strg+Tab / Strg+W', 'nächster Reiter / Reiter schließen'],
            ['Pos1, Bild auf, Bild ab, Ende', 'erste, vorherige, nächste, letzte Seite'],
        ], 'Einzelseiten, zwei Seiten nebeneinander und „Titelseite einzeln“ stehen im Menüband unter „Ansicht“. Der Knopf „Seiten“ zeigt die Vorschaubilder.'),

        ('h1', 'Suchen'),
        ('ul', [
            'In der geöffneten PDF: ' + keys('Strg+F') + ', weiter mit ' + keys('F3') + ', zurück mit ' + keys('Umschalt+F3') + '.',
            'In allen PDFs: das Suchfeld der Bibliothek durchsucht den gesamten Text (Volltextsuche).',
            'Merkliste: den Stern auf einer Seite antippen; die Seiten stehen dann in der Bibliothek unter „Merkliste“.',
        ]),

        ('h1', 'Scans und Texterkennung'),
        ('ul', [
            'Scans werden automatisch durchsuchbar gemacht – im Hintergrund, während Sie weiterarbeiten.',
            'Die Anzeige „OCR“ oben rechts: grau = bereit, flackernd = erkennt gerade, leerer Kreis = Automatik aus. '
            'Antippen zeigt den Fortschritt und bietet Anhalten, Automatik an/aus und „Diese PDF jetzt erkennen“.',
            'Scans aufbereiten (Werkzeuge): schiefe Seiten gerade richten, leere Seiten entfernen, Kontrast verstärken.',
            'In der Windows-App erkennt die in Windows eingebaute Texterkennung den Text – deutlich schneller.',
        ]),

        ('h1', 'Notizbuch'),
        ('p', 'Im Notizbuch schreiben Sie auf Seiten mit unbegrenzter Fläche, geordnet in Notizbüchern und Abschnitten.'),
        ('ul', [
            'Folien samt Ihren Notizen übernehmen: Werkzeuge → „Ins Notizbuch übernehmen“ oder Folien aus der Seitenleiste auf die Notizseite ziehen.',
            'Vorlagen einfügen: Cornell, Besprechung, Vorlesung.',
            'Textbausteine wie „Wichtig!“ oder „Definition“ und Folienmarken aus der Werkzeug-Seitenleiste setzen.',
            'Verknüpfungen zwischen Notizseiten und PDFs in beide Richtungen; „Wer verweist hierher?“ zeigt die Gegenrichtung.',
            'Frühere Stände wiederherstellen; eine Notizseite als PDF speichern oder drucken (auf A4-Seiten verteilt).',
        ]),

        ('h1', 'Zwei Dokumente nebeneinander'),
        ('p', 'Mit ' + keys('Strg+Umschalt+D') + ' oder dem Knopf in der Symbolleiste öffnet sich rechts ein zweiter Bereich. Dort wählen Sie eine PDF '
              'aus der Bibliothek oder eine Notizseite. Beide Seiten nutzen dieselben Leisten; Folien lassen sich aus der Seitenleiste links auf die '
              'Notizseite rechts ziehen. Der Doppelpfeil im rechten Bereich tauscht die Seiten.'),

        ('h1', 'Präsentationen'),
        ('h2', 'Erstellen und aus PowerPoint übernehmen'),
        ('ul', [
            'Bibliothek → Präsentationen → <b>Neue Präsentation</b> oder <b>PowerPoint öffnen</b> (eine oder mehrere .pptx-Dateien).',
            'Einen ganzen Ordner übernehmen: Menü (drei Punkte) auf der Karte „PowerPoint öffnen“ → „Ganzen Ordner übernehmen“; in der Windows-App '
            'auch Datei → „Ordner mit PowerPoint-Dateien übernehmen“. Am Ende zeigt eine Liste, was übernommen wurde.',
            'Übernommen werden Texte, Formen, Bilder, Tabellen, Diagramme, SmartArt-Grafiken, Formeln, Farbverläufe, Animationen und Übergänge.',
        ]),
        ('h2', 'Bearbeiten, vorführen und speichern'),
        ('ul', [
            'Bearbeiten wie in PowerPoint: Folien und Layouts, Design, Textfelder, Formen, Bilder, Tabellen und Diagramme; Animationen im Reiter „Animationen“.',
            'Vorführen: ' + keys('F5') + ' von Beginn an, ' + keys('Umschalt+F5') + ' ab der aktuellen Folie; dazu die Referentenansicht mit nächster Folie, Stoppuhr und Notizen.',
            'Speichern: als PDF oder wieder als PowerPoint-Datei – die Animationen bleiben erhalten.',
        ]),
        ('h2', 'PDFs präsentieren'),
        ('ul', [
            'Präsentation mit Laserpointer: ' + keys('Strg+L') + '; mit Referentenansicht: ' + keys('Strg+Umschalt+P') + '.',
            ('Live-Mitschau für Studierende per QR-Code (Werkzeuge).', 'S'),
        ]),

        ('h1', 'Werkzeuge'),
        ('p', 'Der Knopf „Werkzeuge“ oben öffnet die Übersicht aller Werkzeuge; die Werkzeug-Seitenleiste lässt sich auch durchsuchen.'),
        ('ul', [
            'PDF erstellen, Zusammenfügen, Seiten organisieren (drehen, löschen, verschieben, herausziehen, aufteilen).',
            'Text bearbeiten, Bilder bearbeiten, Exportieren (Word, Excel, PowerPoint, Bilder).',
            'Kopf- und Fußzeile, Seitenzahlen, Wasserzeichen, Lesezeichen, Stempel.',
            'Handzettel mit 2–9 Folien pro Seite, auch mit Notizlinien (als neue PDF im selben Ordner).',
            'Vergleichen mit einer früheren Fassung oder einer anderen PDF.',
            'Ausfüllen und Unterschreiben, Formular vorbereiten, mit Passwort schützen.',
        ]),

        ('h1', 'Schwärzen'),
        ('ul', [
            'Schwärzen: Bereiche aufziehen und „Schwärzen anwenden“ wählen – der Inhalt darunter ist danach endgültig entfernt.',
            'Suchen und schwärzen: Namen eingeben oder automatisch finden lassen (E-Mail, Telefon, IBAN, Matrikelnummer, Datum), prüfen, anwenden.',
            'Alte, ungeschwärzte Fassungen werden gelöscht (abschaltbar in den Einstellungen).',
        ]),

        ('h1', 'Speichern und Weitergeben'),
        ('ul', [
            'PDF mit Notizen speichern: ' + keys('Strg+S') + ' öffnet „Speichern unter“ (PC).',
            'Herausziehen: einen Reiter oder eine PDF aus der Bibliothek auf den Desktop, in einen Ordner oder in eine Outlook-Mail ziehen – mit Notizen (PC).',
            'Drucken: ' + keys('Strg+P') + '.',
            ('Mit Notizen teilen: Menü (drei Punkte) → Teilen (Tablet).', 'S'),
            'Frühere Fassungen ansehen und wiederherstellen: Werkzeuge → Vergleichen → „Mit einer früheren Fassung“.',
        ]),

        ('h1', 'Einstellungen'),
        ('p', 'Datei → Einstellungen oder ' + keys('Strg+,') + ' (PC); auf dem Tablet Menü (drei Punkte) → Einstellungen. Dort finden Sie Seitenanzeige, '
              'Startwerkzeug, Druckqualität, automatische Texterkennung, Schwärzen, frühere Fassungen, Zielordner, überwachten Ordner, Sprache und Nutzungsprotokoll.', 'S'),
        ('p', 'Datei → Einstellungen oder ' + keys('Strg+,') + '. Dort finden Sie Seitenanzeige, Startwerkzeug, Druckqualität, automatische Texterkennung, '
              'Schwärzen, frühere Fassungen, Zielordner, überwachten Ordner, Sprache und den Bibliotheksordner (Einstellungen → Bibliothek).', 'L'),

        ('h1', 'Updates und Sicherung'),
        ('ul', [
            ('„Update verfügbar“ (blau) bedeutet eine neue Windows-App, „Server-Update“ (grün) eine neue Server-Version – jeweils anklicken und „Installieren“ wählen.', 'S'),
            ('Tablet: Menü (drei Punkte) → App aktualisieren.', 'S'),
            ('Sicherung: jede Nacht nach Nextcloud. Bibliothek → „Gerät &amp; Sicherung“ → „Sicherung prüfen“ oder „Wiederherstellen“.', 'S'),
            ('Ein gelber Hinweis „Sicherung“ oben bedeutet, dass die Sicherung hängt – antippen.', 'S'),
            ('„Update verfügbar“ (blau) erscheint, sobald auf GitHub eine neue Version bereitsteht – anklicken und „Installieren“ wählen. '
             'Selbst nachsehen: Hilfe → Nach Updates suchen.', 'L'),
            ('Sicherung: Ihre PDFs sind normale Dateien im Bibliotheksordner. Sichern Sie diesen Ordner mit Ihrer üblichen Datensicherung (Hilfe → Bibliotheksordner öffnen).', 'L'),
        ]),

        ('h1', 'Hilfe und Rückmeldung'),
        ('ul', [
            'Diese Kurzanleitung: Hilfe → Kurzanleitung oder ' + keys('F1') + '. Sie liegt als PDF im Ordner „Hilfe“ Ihrer Bibliothek; Sie können darin wie in jeder PDF schreiben.',
            'Versionsnummern: Hilfe → Über PDF-Stift.',
            ('Bericht für Verbesserungen (Hilfe-Menü oder Menü „Mehr“): kopieren und an die Betreuung des Servers schicken.', 'S'),
            ('Tablet: Menü (drei Punkte) → Fehler melden (mit Bildschirmfoto).', 'S'),
            ('Fehler und Wünsche: als „Issue“ auf der Projektseite bei GitHub (Hilfe → Projektseite auf GitHub).', 'L'),
        ]),
    ],
}

EN = {
    'title': 'PDF-Stift: Quick Guide',
    'titlepage': {
        'S': ['PDF-Stift', 'Quick guide for the browser, the Windows app and the tablet', 'October 2026'],
        'L': ['PDF-Stift', 'Quick guide for the Windows and Linux apps', 'October 2026'],
    },
    'table': 'Table',
    'note': 'Note.',
    'blocks': [
        ('p', 'PDF-Stift is a program for reading, annotating and organizing PDF files such as lecture slides, papers and scans. '
              'You can also keep notebooks and design presentations or import them from PowerPoint. '
              'This quick guide shows what is available and where to find it.'),
        ('p', '“PC” and “tablet” mark where a feature is available: “PC” means the Windows app and the browser, “tablet” the Android app. '
              'Menu names refer to the Windows app; in the browser almost everything is in the “More” menu (three dots at the top right).', 'S'),
        ('p', 'This edition runs entirely on your PC. It needs no account and no server, and your PDFs stay as ordinary files in a folder on your computer.', 'L'),

        ('h1', 'The Window'),
        ('p', 'At the very top are the tabs of the open documents. Next to them on the right are the <b>Pages</b>, <b>Comments</b>, <b>Tools</b> and '
              '<b>Presentation</b> buttons, the switch between light and dark design, and the “Saved” indicator.'),
        ('p', 'Below them is the ribbon with the tabs File, Start, Insert, Drawing, Pages, Slide show, View and Help – arranged as in office programs. '
              'Double-clicking a tab or pressing ' + keys('Ctrl+F1') + ' collapses and expands the ribbon. In the Windows app, '
              + keys('Alt') + ' shows the classic menu bar with every command.'),
        ('p', 'Under the ribbon are the pen bar (favorite pens, undo, zoom) and the tool bar (tools, colors and stroke widths) with the toolbar. '
              'Drag any bar by its grip on the left to any edge of the window. <b>View → Default layout</b> puts everything back; '
              '<b>View → Compact (ribbon only)</b> hides the tool bar.'),

        ('h1', 'Opening Files and the Library'),
        ('p', 'The library has three areas: <b>My PDFs</b>, <b>Notebook</b> and <b>Presentations</b>. Tapping a document opens it in its own tab.'),
        ('ul', [
            ('Open a PDF: tap it in the library or press ' + keys('Ctrl+O') + ' (uploads a file).', 'S'),
            ('Open a PDF: tap it in the library or press ' + keys('Ctrl+O') + '.', 'L'),
            ('Library folder: your PDFs are ordinary files in <b>Documents\\PDF-Stift</b>. Open it with Help → Open library folder; '
             'change it with Help → Change library folder (or Settings → Library).', 'L'),
            'Drag files in from Explorer – Word, PowerPoint and Excel files too; they become PDFs (PC).',
            'Right-click in Explorer → “Open in PDF-Stift” (on Windows 11 first “Show more options”) or “Send to → PDF-Stift” (PC).',
            'Print from Word, Chrome or Outlook to the “PDF-Stift” printer; set it up once with File → Set up as printer (PC).',
            'Watched folder: everything put there is added automatically (File → Settings; PC).',
            'Recently opened: right-click the PDF-Stift icon in the taskbar (PC).',
            ('From other apps: Share → PDF-Stift (tablet).', 'S'),
        ]),

        ('h1', 'Writing and Marking Up'),
        ('p', 'Pen, highlighter, text highlighting, shapes, text box, lasso and eraser are in the tool bar and on the ribbon under “Start” and “Drawing”. '
              'Notes are saved immediately and synchronized between PC and tablet.', 'S'),
        ('p', 'Pen, highlighter, text highlighting, shapes, text box, lasso and eraser are in the tool bar and on the ribbon under “Start” and “Drawing”. '
              'Notes are saved immediately – right in the library folder on your PC.', 'L'),
        ('table', 'Keys for the Tools', ['Key', 'Tool'], [
            ['V', 'Select text'], ['H', 'Hand (move)'], ['P', 'Pen'], ['M', 'Highlighter (free)'], ['U', 'Highlight text'],
            ['T', 'Text box'], ['E', 'Eraser'], ['Hold the space bar', 'temporarily the hand; the middle mouse button as well'],
            ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
        ], 'The keys work on the PC. Right-clicking selected text offers highlight, underline, strike-through and copy.'),

        ('h1', 'Comments'),
        ('ul', [
            'Choose the “Comment” tool, tap the page, write, and choose “Done”.',
            'Tap a note to read, change or delete it.',
            'All comments as a list: the “Comments” button at the top (PC).',
            ('On the tablet: menu (three dots) → Comments (list).', 'S'),
            'When you save or share, they become real PDF comments that other PDF programs show as well.',
        ]),

        ('h1', 'View and Navigation'),
        ('table', 'Shortcuts for View and Navigation', ['Keys', 'Effect'], [
            ['Ctrl+0', 'fit page'], ['Ctrl+1', 'actual size (100 %)'], ['Ctrl+2', 'fit width'],
            ['Ctrl+Plus / Ctrl+Minus', 'zoom in / zoom out'],
            ['Ctrl+Shift+R / Ctrl+Shift+L', 'rotate the view right / left (the PDF itself is unchanged)'],
            ['Ctrl+Shift+D', 'two documents side by side'],
            ['Ctrl+H', 'hide toolbars'], ['F11', 'full screen'],
            ['Ctrl+Tab / Ctrl+W', 'next tab / close tab'],
            ['Home, Page Up, Page Down, End', 'first, previous, next, last page'],
        ], 'Single pages, two pages side by side and “cover page alone” are on the ribbon under “View”. The “Pages” button shows the thumbnails.'),

        ('h1', 'Searching'),
        ('ul', [
            'In the open PDF: ' + keys('Ctrl+F') + ', next with ' + keys('F3') + ', previous with ' + keys('Shift+F3') + '.',
            'In all PDFs: the search field in the library searches the full text.',
            'Starred: tap the star on a page; the pages then appear in the library under “Starred”.',
        ]),

        ('h1', 'Scans and Text Recognition'),
        ('ul', [
            'Scans are made searchable automatically – in the background while you keep working.',
            'The “OCR” indicator at the top right: gray = ready, flickering = recognizing, empty circle = automatic recognition off. '
            'Tap it to see the progress, to pause, to switch automatic recognition on or off, or to recognize the current PDF now.',
            'Clean up scans (Tools): straighten skewed pages, remove blank pages, increase contrast.',
            'In the Windows app the text recognition built into Windows does the work – much faster.',
        ]),

        ('h1', 'Notebook'),
        ('p', 'In the notebook you write on pages with unlimited space, organized in notebooks and sections.'),
        ('ul', [
            'Copy slides with your notes: Tools → “Copy to notebook”, or drag slides from the page sidebar onto the notebook page.',
            'Insert templates: Cornell, meeting, lecture.',
            'Add text snippets such as “Important!” or “Definition” and slide markers from the tools sidebar.',
            'Link notebook pages and PDFs in both directions; “What links here?” shows the other direction.',
            'Restore earlier versions; save or print a notebook page as PDF (split onto A4 pages).',
        ]),

        ('h1', 'Two Documents Side by Side'),
        ('p', 'Press ' + keys('Ctrl+Shift+D') + ' or use the button in the toolbar to open a second area on the right. There you choose a PDF from the library '
              'or a notebook page. Both sides share the same bars; you can drag slides from the page sidebar on the left onto the notebook page on the right. '
              'The double arrow in the right area swaps the sides.'),

        ('h1', 'Presentations'),
        ('h2', 'Creating and Importing from PowerPoint'),
        ('ul', [
            'Library → Presentations → <b>New presentation</b> or <b>Open PowerPoint</b> (one or more .pptx files).',
            'Import a whole folder: the menu (three dots) on the “Open PowerPoint” card → “Import whole folder”; in the Windows app also '
            'File → “Import folder of PowerPoint files”. A list shows what was imported.',
            'Text, shapes, pictures, tables, charts, SmartArt graphics, equations, gradients, animations and transitions are imported.',
        ]),
        ('h2', 'Editing, Presenting and Saving'),
        ('ul', [
            'Edit as in PowerPoint: slides and layouts, design, text boxes, shapes, pictures, tables and charts; animations on the “Animations” tab.',
            'Present: ' + keys('F5') + ' from the beginning, ' + keys('Shift+F5') + ' from the current slide; the presenter view shows the next slide, a timer and your notes.',
            'Save as PDF or back as a PowerPoint file – the animations are kept.',
        ]),
        ('h2', 'Presenting PDFs'),
        ('ul', [
            'Presentation with laser pointer: ' + keys('Ctrl+L') + '; with presenter view: ' + keys('Ctrl+Shift+P') + '.',
            ('Live view for students via QR code (Tools).', 'S'),
        ]),

        ('h1', 'Tools'),
        ('p', 'The “Tools” button at the top opens the overview of all tools; the tools sidebar can be searched as well.'),
        ('ul', [
            'Create PDF, combine, organize pages (rotate, delete, move, extract, split).',
            'Edit text, edit images, export (Word, Excel, PowerPoint, images).',
            'Header and footer, page numbers, watermark, bookmarks, stamps.',
            'Handouts with 2–9 slides per page, with note lines if you like (as a new PDF in the same folder).',
            'Compare with an earlier version or another PDF.',
            'Fill and sign, prepare forms, protect with a password.',
        ]),

        ('h1', 'Redacting'),
        ('ul', [
            'Redact: drag over areas and choose “Apply redaction” – the content underneath is removed for good.',
            'Find and redact: enter names or let PDF-Stift find them (e-mail, phone, IBAN, student ID, date), check, apply.',
            'Old, unredacted versions are deleted (can be switched off in the settings).',
        ]),

        ('h1', 'Saving and Sharing'),
        ('ul', [
            'Save the PDF with notes: ' + keys('Ctrl+S') + ' opens “Save as” (PC).',
            'Drag out: drag a tab or a PDF from the library to the desktop, into a folder or into an Outlook e-mail – with notes (PC).',
            'Print: ' + keys('Ctrl+P') + '.',
            ('Share with notes: menu (three dots) → Share (tablet).', 'S'),
            'View and restore earlier versions: Tools → Compare → “With an earlier version”.',
        ]),

        ('h1', 'Settings'),
        ('p', 'File → Settings or ' + keys('Ctrl+,') + ' (PC); on the tablet menu (three dots) → Settings. There you find page display, start tool, '
              'print quality, automatic text recognition, redaction, earlier versions, target folder, watched folder, language and usage log.', 'S'),
        ('p', 'File → Settings or ' + keys('Ctrl+,') + '. There you find page display, start tool, print quality, automatic text recognition, redaction, '
              'earlier versions, target folder, watched folder, language and the library folder (Settings → Library).', 'L'),

        ('h1', 'Updates and Backup'),
        ('ul', [
            ('“Update available” (blue) means a new Windows app, “Server update” (green) a new server version – click it and choose “Install”.', 'S'),
            ('Tablet: menu (three dots) → Update app.', 'S'),
            ('Backup: every night to Nextcloud. Library → “Device &amp; backup” → “Check backup” or “Restore”.', 'S'),
            ('A yellow “Backup” notice at the top means the backup is stuck – tap it.', 'S'),
            ('“Update available” (blue) appears as soon as a new version is out on GitHub – click it and choose “Install”. '
             'To check yourself: Help → Check for updates.', 'L'),
            ('Backup: your PDFs are ordinary files in the library folder. Back up this folder with your usual backup (Help → Open library folder).', 'L'),
        ]),

        ('h1', 'Help and Feedback'),
        ('ul', [
            'This quick guide: Help → Quick guide or ' + keys('F1') + '. It is a PDF in the “Help” folder of your library; you can write in it like in any PDF.',
            'Version numbers: Help → About PDF-Stift.',
            ('Improvement report (Help menu or “More” menu): copy it and send it to whoever runs your server.', 'S'),
            ('Tablet: menu (three dots) → Report a problem (with screenshot).', 'S'),
            ('Bugs and wishes: as an issue on the project page on GitHub (Help → Project page on GitHub).', 'L'),
        ]),
    ],
}


def for_ed(entry, ed):
    """Eintrag für diese Ausgabe? (Text ohne Kennzeichen gilt für beide)"""
    if isinstance(entry, tuple):
        return entry[0] if entry[1] == ed else None
    return entry


def build(lang, ed):
    C = DE if lang == 'de' else EN
    path = os.path.join(OUT, f'kurzanleitung-{"server" if ed == "S" else "local"}.{lang}.pdf')
    W, H = A4

    def page_no(canvas, doc):
        # APA: Seitenzahl oben rechts auf jeder Seite, auf Höhe der oberen Randlinie
        canvas.saveState()
        canvas.setFont('C', FS)
        canvas.drawRightString(W - MARGIN, H - MARGIN / 2 - FS / 2, str(doc.page))
        canvas.restoreState()

    doc = BaseDocTemplate(path, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
                          title=C['title'], author='PDF-Stift', subject=C['titlepage'][ed][1], lang=lang, creator='PDF-Stift')
    frame = Frame(MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=page_no)])

    S = []
    # Titelseite: drei bis vier Zeilen unter dem oberen Rand, Titel fett, danach Leerzeile und Angaben
    S.append(Spacer(1, LEAD * 3))
    S.append(Paragraph(C['title'], title_s))
    S.append(Spacer(1, LEAD))
    for line in C['titlepage'][ed]:
        S.append(Paragraph(line, center))
    S.append(PageBreak())
    # erste Textseite: Titel wiederholt (fett, zentriert), dann die Einleitung ohne Überschrift
    S.append(Paragraph(C['title'], title_s))
    tno = 0
    width = W - 2 * MARGIN
    for b in C['blocks']:
        kind = b[0]
        if len(b) > 2 and isinstance(b[2], str) and b[2] in 'SL' and kind in ('p', 'h1', 'h2'):
            if b[2] != ed:
                continue
        if kind == 'h1':
            S.append(CondPageBreak(LEAD * 4))
            S.append(Paragraph(b[1], h1))
        elif kind == 'h2':
            S.append(Paragraph(b[1], h2))
        elif kind == 'p':
            S.append(Paragraph(b[1], body))
        elif kind == 'ul':
            items = [x for x in (for_ed(e, ed) for e in b[1]) if x]
            S.append(ListFlowable([ListItem(Paragraph(t, item), leftIndent=INDENT, value='•') for t in items],
                                  bulletType='bullet', start='•', leftIndent=INDENT, bulletFontName='C', bulletFontSize=FS))
        elif kind == 'table':
            tno += 1
            _, ttl, head, rows, note = b
            data = [[Paragraph(h, thead) for h in head]] + [[Paragraph(keys(r[0]) if r[0] and len(r[0]) < 40 else r[0], tcell), Paragraph(r[1], tcell)] for r in rows]
            t = Table(data, colWidths=[width * 0.38, width * 0.62], repeatRows=1)
            t.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                # APA: nur waagrechte Linien – über und unter der Kopfzeile sowie am Ende
                ('LINEABOVE', (0, 0), (-1, 0), 0.8, colors.black),
                ('LINEBELOW', (0, 0), (-1, 0), 0.8, colors.black),
                ('LINEBELOW', (0, -1), (-1, -1), 0.8, colors.black),
            ]))
            block = [Paragraph(f"{C['table']} {tno}", tnum), Paragraph(ttl, ttitle), t]
            if note:
                block.append(Paragraph(f"<i>{C['note']}</i> {note}", tnote))
            S.append(Spacer(1, LEAD * 0.3))
            S.append(KeepTogether(block))
    doc.build(S)
    return path


def check_glyphs():
    """Zeichen, die Carlito nicht hat, würden als Kästchen erscheinen – vorher melden."""
    from fontTools.ttLib import TTFont as FT
    cmap = FT(os.path.join(FONTS, 'Carlito-Regular.ttf'))['cmap'].getBestCmap()
    bad = set()
    for C in (DE, EN):
        texts = [C['title']] + sum(C['titlepage'].values(), [])
        for b in C['blocks']:
            for x in b[1:]:
                if isinstance(x, str):
                    texts.append(x)
                elif isinstance(x, list):
                    for e in x:
                        texts.extend([e[0]] if isinstance(e, tuple) and isinstance(e[0], str) and not isinstance(e[0], list) else (e if isinstance(e, list) else [e]))
        for t in texts:
            if isinstance(t, str):
                bad |= {ch for ch in t if ord(ch) > 127 and ord(ch) not in cmap}
    if bad:
        sys.exit('Fehlende Zeichen in Carlito: ' + ' '.join(sorted(bad)))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    try:
        check_glyphs()
    except ImportError:
        pass
    for lang in ('de', 'en'):
        for ed in ('S', 'L'):
            print(build(lang, ed))
