<?php
declare(strict_types=1);
require_once __DIR__ . '/lib/common.php';
require_once __DIR__ . '/lib/demo.php';
// englische Oberfläche: index.en.php wird aus dieser Datei erzeugt (tools/i18n)
if (basename(__FILE__) === 'index.php' && ui_lang() === 'en' && is_file(__DIR__ . '/index.en.php')) {
    require __DIR__ . '/index.en.php';
    exit;
}
$v = PDFSTIFT_VERSION;
$demo = demo_public();
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: frame-ancestors 'self'");
header('Referrer-Policy: same-origin');
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>PDF-Stift</title>
<meta name="theme-color" content="#1E2F6E">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="PDF-Stift">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="stylesheet" href="app/app.css?v=<?= $v ?>">
<script>try { var t = JSON.parse(localStorage.getItem('pdfstift.theme')); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}</script>
</head>
<body data-ed="<?= edition() ?>"<?= $demo ? ' data-demo="1"' : '' ?>>

<section id="auth" class="auth" hidden>
  <form id="authForm" class="auth-card">
    <div class="brand"><img src="icons/icon.svg" alt="" width="40" height="40"><span>PDF-Stift</span></div>
    <h1 id="authTitle">Anmelden</h1>
    <p id="authText" class="muted">Gib dein Passwort ein.</p>
    <label for="pw">Passwort</label>
    <input id="pw" type="password" autocomplete="current-password" required minlength="1"<?= $demo ? ' value="' . htmlspecialchars($demo['password']) . '"' : '' ?>>
<?php if ($demo): ?>
    <p class="demo-note">Öffentliche Demo – das Passwort „<b><?= htmlspecialchars($demo['password']) ?></b>“ ist schon eingetragen. Einfach auf „Anmelden“ tippen.</p>
<?php endif; ?>
    <div id="codeRow" hidden>
      <label for="code2">Code aus der Authenticator-App</label>
      <input id="code2" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="6 Ziffern oder Notfall-Code">
    </div>
    <button type="submit" class="btn primary" id="authBtn">Anmelden</button>
    <p id="authErr" class="err" role="alert"></p>
  </form>
</section>

<?php if ($demo): ?>
<div id="demoBar" class="demo-bar" role="note"><b>Demo</b><span>Wird jede volle Stunde zurückgesetzt – bitte keine persönlichen Dateien hochladen.</span><?php if ($demo['credit'] !== ''): ?><span class="muted"><?= htmlspecialchars($demo['credit']) ?></span><?php endif; ?><a href="https://github.com/ek1-wq/pdf-stift/releases/latest" target="_blank" rel="noopener">Kostenlos herunterladen</a></div>
<?php endif; ?>
<div id="shell" class="shell" hidden>
  <header class="topbar">
    <button id="btnLib" class="icon-btn" type="button" aria-label="Meine PDFs" title="Meine PDFs">
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>
    </button>
    <nav id="tabs" class="tabs" role="tablist" aria-label="Geöffnete PDFs"></nav>
    <button id="liveBadge" type="button" class="live-badge srv-only" hidden><i></i><span>LIVE</span></button>
    <div id="viewRow" class="view-row">
      <div id="viewBar" class="view-bar" role="toolbar" aria-label="Ansicht und Bearbeiten" hidden>
        <span class="menu-wrap vb-grip-wrap"><button id="vbGrip" type="button" class="tb-grip vb-grip" aria-label="Symbolleiste verschieben" title="Leiste verschieben: an den Rand ziehen – oder antippen"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></button></span>
        <button type="button" class="vb-b vb-x" data-vb="save" title="Speichern mit Notizen (Strg+S)" aria-label="Speichern"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg></button>
        <button type="button" class="vb-b vb-x" data-vb="print" title="Drucken (Strg+P)" aria-label="Drucken"><svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6H7z"/></svg></button>
        <span class="vb-sep vb-x"></span>
        <span class="vb-seg">
          <button type="button" class="vb-b" data-vb="single" title="Einzelseiten untereinander" aria-label="Einzelseiten"><svg viewBox="0 0 24 24"><rect x="7" y="3.5" width="10" height="17" rx="1.5"/></svg></button>
          <button type="button" class="vb-b" data-vb="two" title="Zwei Seiten nebeneinander" aria-label="Zwei Seiten nebeneinander"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="8.5" height="14" rx="1.2"/><rect x="13" y="5" width="8.5" height="14" rx="1.2"/></svg></button>
          <button type="button" class="vb-b" data-vb="cover" title="Wie ein Buch: Titelseite einzeln, dann je zwei Seiten" aria-label="Buchansicht"><svg viewBox="0 0 24 24"><path d="M12 6.5C10 5 6.5 4.5 3 5v13.5c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V5c-3.5-.5-7 0-9 1.5zM12 6.5V20"/></svg></button>
        </span>
        <button type="button" class="vb-b" data-vb="split" title="Zwei Dokumente nebeneinander (rechts ein zweites PDF)" aria-label="Zwei Dokumente nebeneinander"><svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="1.5"/><path d="M12 4v16"/><path d="M5 8h4M5 11h4M15 8h4M15 11h4M15 14h3"/></svg></button>
        <span class="vb-sep"></span>
        <button type="button" class="vb-b" data-vb="fitw" title="Seitenbreite (Strg+2)" aria-label="Seitenbreite"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M7 12h10M7 12l2.5-2.5M7 12l2.5 2.5M17 12l-2.5-2.5M17 12l-2.5 2.5"/></svg></button>
        <button type="button" class="vb-b" data-vb="fitp" title="Ganze Seite (Strg+0)" aria-label="Ganze Seite"><svg viewBox="0 0 24 24"><rect x="6.5" y="3.5" width="11" height="17" rx="1.5"/><path d="M9.5 8.5V7h5v1.5M9.5 15.5V17h5v-1.5"/></svg></button>
        <button type="button" class="vb-b" data-vb="zout" title="Verkleinern (Strg+−)" aria-label="Verkleinern"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5"/></svg></button>
        <button type="button" class="vb-b" data-vb="zin" title="Vergrößern (Strg++)" aria-label="Vergrößern"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5M11 8.5v5"/></svg></button>
        <button type="button" class="vb-b vb-x" data-vb="rotL" title="Ansicht links drehen" aria-label="Ansicht links drehen"><svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.05-4.95M5 4v4h4"/></svg></button>
        <button type="button" class="vb-b" data-vb="rotR" title="Ansicht rechts drehen" aria-label="Ansicht rechts drehen"><svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"/></svg></button>
        <span class="vb-sep"></span>
        <button type="button" class="vb-b" data-vb="undo" id="vbUndo" title="Rückgängig (Strg+Z)" aria-label="Rückgängig"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <button type="button" class="vb-b" data-vb="redo" id="vbRedo" title="Wiederholen (Strg+Y)" aria-label="Wiederholen"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
        <button type="button" class="vb-b" data-vb="find" title="In der PDF suchen (Strg+F)" aria-label="In der PDF suchen"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg></button>
        <span class="vb-sep vb-x"></span>
        <button type="button" class="vb-b vb-x" data-vb="focus" title="Leisten ausblenden – nur die Seite (Strg+H)" aria-label="Leisten ausblenden"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      </div>
      <span class="vr-sp"></span>
      <button id="thBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Seitenvorschau neben der PDF ein-/ausblenden" hidden>
        <svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M15 4v16"/><path d="M17 8h1.5M17 12h1.5M17 16h1.5"/></svg>
        <span>Seiten</span>
      </button>
      <button id="cmBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Kommentare: alle Notizzettel dieser PDF als Liste" hidden>
        <svg viewBox="0 0 24 24"><path d="M5 5h14v10H10l-4 4v-4H5z"/></svg>
        <span>Kommentare</span>
      </button>
      <button id="toolsBtn" type="button" class="text-btn present-btn" title="Werkzeuge: Bearbeiten, Formulare, Unterschrift, Umwandeln, Schützen …">
        <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/></svg>
        <span>Werkzeuge</span>
      </button>
      <button id="presentBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Präsentation: nur die Seite zeigen – für Beamer und Bildschirmspiegelung" hidden>
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/></svg>
        <span>Präsentation</span>
      </button>
      <button id="vrCfg" type="button" class="vb-b vr-cfg" title="Symbolleiste anpassen" aria-label="Symbolleiste anpassen"><svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>
    </div>
    <button id="srvUpd" type="button" class="upd-pill srv-pill srv-only" hidden title="Neue Version für den Server – mit einem Klick einspielen"><span class="upd-dot"></span><span id="srvUpdText">Server-Update</span></button>
    <button id="bkWarn" type="button" class="bk-warn srv-only" hidden title="Mit der Sicherung stimmt etwas nicht – antippen für Einzelheiten"><span>⚠︎</span><span id="bkWarnText">Sicherung</span></button>
    <button id="winUpd" type="button" class="upd-pill" hidden><span class="upd-dot"></span><span id="winUpdText">Update verfügbar</span></button>
    <button id="themeBtn" type="button" class="theme-btn" title="Helles oder dunkles Design" aria-label="Helles oder dunkles Design">
      <svg class="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>
      <svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>
    </button>
    <div class="ocr-wrap">
      <button id="ocrInd" type="button" class="ocr-ind" data-state="idle" aria-haspopup="true" aria-expanded="false" title="Texterkennung (Scans durchsuchbar machen)">
        <span class="led" aria-hidden="true"></span><span class="ocr-lbl">OCR</span>
        <span id="ocrCount" class="ocr-count"></span>
      </button>
      <div id="ocrPop" class="ocr-pop" hidden role="dialog" aria-label="Texterkennung">
        <div class="op-head"><b>Texterkennung</b><span class="muted small">macht Scans durchsuchbar und markierbar</span></div>
        <div id="opStatus" class="op-status"></div>
        <div class="op-prog" hidden><i id="opBar"></i></div>
        <label class="check op-auto"><input id="opAuto" type="checkbox"> <span>Scans automatisch erkennen<br><span class="muted small">beim Öffnen eines Scans, im Hintergrund</span></span></label>
        <div class="op-btns"><button id="opNow" type="button" class="btn">Diese PDF jetzt erkennen</button><button id="opStop" type="button" class="btn">Anhalten</button></div>
      </div>
    </div>
    <div id="sync" class="sync" data-state="ok" title="">
      <span class="dot"></span><span id="syncText">Gespeichert</span>
    </div>
  </header>

  <div id="dockT" class="dock dock-h">
  <div id="toolbar" class="toolbar" hidden>
    <div class="tb-row">
      <div class="menu-wrap tb-grip-wrap">
        <button id="tbGrip" type="button" class="tb-grip" aria-label="Werkzeugleiste verschieben" title="Leiste verschieben: an den Rand ziehen – oder antippen">
          <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
        </button>
      </div>
      <div id="favs" class="favs" aria-label="Favoriten"></div>
      <button id="favAdd" type="button" class="icon-btn" aria-label="Aktuelles Werkzeug als Favorit speichern" title="Als Favorit speichern">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <span class="sep"></span>
      <button id="toolsToggle" type="button" class="text-btn" aria-expanded="true" aria-controls="toolsRow" title="Stifte, Farben und Stärken ein- und ausblenden">
        <svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
        <span>Stifte</span>
      </button>
      <div class="spacer"></div>
      <div class="group">
        <button id="undo" type="button" class="icon-btn" aria-label="Rückgängig" title="Rückgängig">
          <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </button>
        <button id="redo" type="button" class="icon-btn" aria-label="Wiederholen" title="Wiederholen">
          <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </button>
      </div>
      <span class="sep"></span>
      <div class="group">
        <button id="zoomOut" type="button" class="icon-btn" aria-label="Verkleinern"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
        <button id="zoomFit" type="button" class="text-btn num" aria-label="Auf Breite einpassen">100 %</button>
        <button id="zoomIn" type="button" class="icon-btn" aria-label="Vergrößern"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
      <span class="sep"></span>
      <button id="searchBtn" type="button" class="icon-btn" aria-label="Im PDF suchen" title="Im PDF suchen" aria-expanded="false">
        <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>
      </button>
      <button id="overviewBtn" type="button" class="icon-btn" aria-label="Seitenübersicht" title="Seitenübersicht">
        <svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="6.5" height="8" rx="1"/><rect x="13.5" y="3.5" width="6.5" height="8" rx="1"/><rect x="4" y="13.5" width="6.5" height="7" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="7" rx="1"/></svg>
      </button>
      <div class="menu-wrap">
      <button id="bdImgBtn" type="button" class="icon-btn" aria-label="Foto aufnehmen oder Bild einfügen" title="Foto aufnehmen oder Bild einfügen">
        <svg viewBox="0 0 24 24"><path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/></svg>
      </button>
      </div>
      <button id="finger" type="button" class="icon-btn" aria-pressed="false" aria-label="Mit dem Finger zeichnen" title="Mit dem Finger zeichnen (für Geräte ohne Stift)">
        <svg viewBox="0 0 24 24"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M12 10V4a1.5 1.5 0 0 1 3 0v7"/><path d="M15 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.7-2.3L4 14.5a1.5 1.5 0 0 1 2.3-1.9L9 15"/></svg>
      </button>
      <div class="menu-wrap">
        <button id="menuBtn" type="button" class="icon-btn" aria-label="Mehr" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>
        </button>
        <div id="menu" class="menu" hidden>
          <button type="button" data-act="bd-fit" class="bd-only">Ganze Seite zeigen</button>
          <button type="button" data-act="bd-img" class="bd-only">Bild einfügen …</button>
          <button type="button" data-act="bd-pdf" class="bd-only">PDF-Seiten einfügen …</button>
          <button type="button" data-act="bd-tpl" class="bd-only">Vorlage einfügen (Cornell, Besprechung, Vorlesung) …</button>
          <button type="button" data-act="link" class="bd-only">Verknüpfung einfügen …</button>
          <button type="button" data-act="backlinks" class="bd-only">Wer verweist hierher? …</button>
          <button type="button" data-act="bd-hist" class="bd-only">Frühere Stände …</button>
          <button type="button" data-act="bd-save" class="bd-only">Als PDF speichern …</button>
          <button type="button" data-act="bd-print" class="bd-only">Drucken …</button>
          <span class="menu-sep bd-only"></span>
          <button type="button" data-act="bg-dots" class="bd-only">Hintergrund: Punkte</button>
          <button type="button" data-act="bg-grid" class="bd-only">Hintergrund: Kariert</button>
          <button type="button" data-act="bg-lines" class="bd-only">Hintergrund: Liniert</button>
          <button type="button" data-act="bg-plain" class="bd-only">Hintergrund: Leer</button>
          <button type="button" data-act="export">PDF mit Notizen herunterladen</button>
          <button type="button" data-act="original">Original herunterladen</button>
          <button type="button" data-act="ncput" class="nc-only" hidden>Mit Notizen nach Nextcloud speichern</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="ins-blank">Leere Seite nach dieser einfügen</button>
          <button type="button" data-act="ins-grid">Karierte Seite nach dieser einfügen</button>
          <button type="button" data-act="ins-lines">Linierte Seite nach dieser einfügen</button>
          <button type="button" data-act="rotate">Diese Seite drehen</button>
          <button type="button" data-act="delpage">Diese Seite löschen …</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="tools"><b>Alle Werkzeuge …</b></button>
          <button type="button" data-act="tags">Schlagwörter …</button>
          <button type="button" data-act="link">Verknüpfung zu einer anderen Seite einfügen …</button>
          <button type="button" data-act="backlinks">Wer verweist auf diese PDF? …</button>
          <button type="button" data-act="paste">Aus der Zwischenablage einfügen (Text oder Bild)</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="ocr">Text erkennen (Scan durchsuchbar machen)</button>
          <button type="button" data-act="scanfix">Scans aufbereiten (gerade richten, leere Seiten, Kontrast) …</button>
          <button type="button" data-act="handout">Handzettel erstellen …</button>
          <button type="button" data-act="findredact">Suchen und schwärzen …</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="live" class="srv-only">Live-Mitschau für Studierende (QR-Code) …</button>
          <button type="button" data-act="resetfavs">Favoriten zurücksetzen</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="two">Zwei Seiten nebeneinander / Einzelseiten</button>
          <button type="button" data-act="vbcfg">Symbolleiste anpassen …</button>
          <button type="button" data-act="viewrot">Ansicht drehen (nur Anzeige)</button>
          <button type="button" data-act="mkf">Folienmarke setzen</button>
          <button type="button" data-act="study">Lernzettel aus Markierungen …</button>
          <button type="button" data-act="tonb">Ins Notizbuch übernehmen …</button>
          <button type="button" data-act="carry">Notizen aus älterer Fassung übernehmen …</button>
          <button type="button" data-act="props">Dokumenteigenschaften …</button>
          <button type="button" data-act="settings"><b>Einstellungen …</b></button>
          <button type="button" data-act="report" class="srv-only">Bericht für Verbesserungen …</button>
          <button type="button" data-act="help">Kurzanleitung</button>
          <button type="button" data-act="about">Über PDF-Stift …</button>
        </div>
      </div>
    </div>

    <div id="searchRow" class="tb-row search-row" hidden>
      <label for="q" class="sr">Im PDF suchen</label>
      <input id="q" type="search" placeholder="Im PDF suchen …" autocomplete="off" enterkeyhint="search">
      <span id="qInfo" class="muted num"></span>
      <button id="qPrev" type="button" class="icon-btn" aria-label="Vorheriger Treffer"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
      <button id="qNext" type="button" class="icon-btn" aria-label="Nächster Treffer"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      <button id="qClose" type="button" class="icon-btn" aria-label="Suche schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  </div>
  <div id="toolbar2" class="toolbar toolbar2" hidden>
    <div class="menu-wrap tb-grip-wrap">
      <button id="tb2Grip" type="button" class="tb-grip" aria-label="Werkzeug-Leiste verschieben" title="Leiste verschieben: an den Rand ziehen – oder antippen">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
      </button>
    </div>
    <div id="toolsRow" class="tb-row tools-row">
      <div class="group seg" role="radiogroup" aria-label="Werkzeug">
        <button type="button" class="tool" data-tool="sel" aria-label="Text auswählen" title="Text auswählen und kopieren (Rechtsklick: hervorheben, kopieren …)">
          <svg viewBox="0 0 24 24"><path d="M5 3.5l13 7.2-5.6 1.4L9.8 18z"/><path d="M12.6 12.4l4.6 6.1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="hand" aria-label="Hand" title="Hand: Seite mit der Maus verschieben (auch: Leertaste gedrückt halten)">
          <svg viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5"/><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.2 7-2.6 0-4-1.2-5.4-3.2L3.7 13a1.4 1.4 0 0 1 2.2-1.7L8 13.5"/></svg>
        </button>
        <button type="button" class="tool" data-tool="pen" aria-label="Stift" title="Stift">
          <svg viewBox="0 0 24 24"><path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg>
        </button>
        <button type="button" class="tool" data-tool="hl" aria-label="Marker (frei)" title="Marker (frei)">
          <svg viewBox="0 0 24 24"><path d="M9 15l-3 3H3l3-3"/><path d="M9 15l9-9 3 3-9 9z"/><path d="M3 21h9"/></svg>
        </button>
        <button type="button" class="tool" data-tool="tx" aria-label="Text markieren" title="Text markieren (rastet am Text ein)">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="1.5" fill="currentColor" opacity=".18" stroke="none"/><path d="M8 15l4-9 4 9M9.6 12h4.8"/><path d="M4 20h16"/></svg>
        </button>
        <button type="button" class="tool" data-tool="sh" aria-label="Formen" title="Linie, Pfeil, Rechteck, Kreis">
          <svg viewBox="0 0 24 24"><path d="M4 20L13 11"/><path d="M8.5 11H13v4.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="tt" aria-label="Textfeld" title="Textfeld: auf die Seite tippen und schreiben">
          <svg viewBox="0 0 24 24"><path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/></svg>
        </button>
        <button type="button" class="tool" data-tool="nt" aria-label="Kommentar" title="Kommentar: Notizzettel auf die Seite setzen">
          <svg viewBox="0 0 24 24"><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M7.5 9h9M7.5 12h6"/></svg>
        </button>
        <button type="button" class="tool" data-tool="la" aria-label="Lasso" title="Lasso: Notizen einkreisen, dann verschieben, umfärben oder löschen">
          <svg viewBox="0 0 24 24"><path d="M12 4c5 0 8.5 2.3 8.5 5.2S17 14.5 12 14.5 3.5 12.2 3.5 9.2 7 4 12 4z" stroke-dasharray="3 2.4"/><path d="M6.5 13.5c-1 1.5-.4 3.4 1.6 3.6 1.8.2 2.1 2 .9 3.4"/></svg>
        </button>
        <button type="button" class="tool" data-tool="lp" aria-label="Laserpointer" title="Laserpointer: zeigen und einkreisen – verblasst nach 2 Sekunden, wird nicht gespeichert">
          <svg viewBox="0 0 24 24" class="laser-ic"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="er" aria-label="Radierer" title="Radierer">
          <svg viewBox="0 0 24 24"><path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.5z"/><path d="M9.5 10.5l5 5"/></svg>
        </button>
      </div>
      <div id="txKinds" class="group seg" aria-label="Art der Textmarkierung">
        <button type="button" class="kind" data-k="hl" aria-label="Hervorheben" title="Hervorheben"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="15" rx="2" fill="currentColor" opacity=".22" stroke="none"/><path d="M8 16l4-9 4 9M9.6 13h4.8"/></svg></button>
        <button type="button" class="kind" data-k="ul" aria-label="Unterstreichen" title="Unterstreichen"><svg viewBox="0 0 24 24"><path d="M8 15l4-9 4 9M9.6 12h4.8"/><path d="M5 19.5h14"/></svg></button>
        <button type="button" class="kind" data-k="st" aria-label="Durchstreichen" title="Durchstreichen"><svg viewBox="0 0 24 24"><path d="M8 18l4-12 4 12M9.3 14h5.4"/><path d="M5 11h14"/></svg></button>
      </div>
      <div id="shKinds" class="group seg" aria-label="Form">
        <button type="button" class="kind" data-k="line" aria-label="Linie" title="Linie"><svg viewBox="0 0 24 24"><path d="M5 19L19 5"/></svg></button>
        <button type="button" class="kind" data-k="arrow" aria-label="Pfeil" title="Pfeil"><svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><path d="M10 5h9v9"/></svg></button>
        <button type="button" class="kind" data-k="rect" aria-label="Rechteck" title="Rechteck"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/></svg></button>
        <button type="button" class="kind" data-k="oval" aria-label="Kreis" title="Kreis / Ellipse"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg></button>
      </div>
      <div id="ttSizes" class="group seg" aria-label="Schriftgröße">
        <button type="button" class="kind" data-fs="9" aria-label="Klein" title="Klein (9 pt)"><span class="fsz" style="font-size:12px">A</span></button>
        <button type="button" class="kind" data-fs="14" aria-label="Mittel" title="Mittel (14 pt)"><span class="fsz" style="font-size:16px">A</span></button>
        <button type="button" class="kind" data-fs="22" aria-label="Groß" title="Groß (22 pt)"><span class="fsz" style="font-size:21px">A</span></button>
      </div>
      <span class="sep"></span>
      <div id="colors" class="group colors" aria-label="Farbe"></div>
      <span class="sep"></span>
      <div id="widths" class="group" aria-label="Strichstärke"></div>
    </div>
  </div>
  </div>
  <div id="dockL" class="dock dock-v"></div>
  <div id="dockR" class="dock dock-v"></div>
  <div id="dockB" class="dock dock-h"></div>

  <section id="overview" class="overview" hidden aria-label="Seitenübersicht">
    <div class="ov-head">
      <div class="seg2" role="tablist">
        <button type="button" data-f="all" class="active" role="tab">Alle Seiten</button>
        <button type="button" data-f="notes" role="tab">Mit Anmerkungen</button>
      </div>
      <p id="ovHint" class="muted small ov-hint">Seiten zum Umsortieren ziehen (mit dem Finger: kurz gedrückt halten)</p>
      <div class="ov-acts">
        <button id="ovIns" type="button" class="btn">PDF einfügen …</button>
        <button id="ovSplit" type="button" class="btn">Herausziehen / Aufteilen …</button>
        <button id="ovSelBtn" type="button" class="btn">Auswählen</button>
        <span id="ovSelActs" class="ov-selacts" hidden>
          <span id="ovSelN" class="muted small"></span>
          <button type="button" class="btn" data-ov="all">Alle</button>
          <button type="button" class="btn" data-ov="rot">Drehen</button>
          <button type="button" class="btn" data-ov="ext">Als neue PDF</button>
          <button type="button" class="btn" data-ov="del">Löschen</button>
        </span>
        <button id="ovClose" type="button" class="btn">Schließen</button>
      </div>
    </div>
    <div id="ovGrid" class="ov-grid"></div>
    <p id="ovEmpty" class="empty" hidden>Auf keiner Seite gibt es bisher Anmerkungen.</p>
  </section>

  <section id="toolsView" class="tools-view" hidden aria-label="Werkzeuge">
    <div class="ov-head">
      <h2 class="tv-title">Werkzeuge <span id="tvDoc" class="muted small"></span></h2>
      <button id="tvClose" type="button" class="btn">Schließen</button>
    </div>
    <div id="tvBody" class="tv-body"></div>
  </section>

  <section id="cmpView" class="tools-view" hidden aria-label="Vergleich">
    <div class="ov-head">
      <div><h2 class="tv-title">Vergleich</h2><p id="cmpSum" class="muted small"></p></div>
      <div class="ov-acts">
        <button id="cmpRestore" type="button" class="btn" hidden>Diese frühere Fassung wiederherstellen …</button>
        <button id="cmpClose" type="button" class="btn">Schließen</button>
      </div>
    </div>
    <div id="cmpBody" class="cmp-body"></div>
  </section>

  <main id="library" class="library">
    <div class="lib-head">
      <div class="lib-title">
        <div class="eyebrow">PDF-Stift</div>
        <h1 id="libTitle">Meine PDFs</h1>
        <div id="srcSwitch" class="seg2 src-switch" role="tablist" aria-label="Quelle">
          <button type="button" data-src="local" role="tab" class="active">
            <svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>Meine PDFs
          </button>
          <button type="button" data-src="nb" role="tab">
            <svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M3.5 7H6M3.5 12H6M3.5 17H6"/></svg>Notizbuch
          </button>
          <button type="button" data-src="nc" role="tab" class="srv-only">
            <svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>Nextcloud
          </button>
          <button type="button" data-src="od" role="tab" class="srv-only">
            <svg viewBox="0 0 24 24"><path d="M9.5 9.2A5 5 0 0 1 18.6 11a3.6 3.6 0 0 1-.6 7.2H7a4 4 0 0 1-.9-7.9A5 5 0 0 1 9.5 9.2z"/></svg>OneDrive
          </button>
        </div>
      </div>
      <div class="lib-actions">
        <label for="search" class="sr">Suchen</label>
        <input id="search" type="search" placeholder="Suchen …" autocomplete="off">
        <a id="winBtn" class="btn primary srv-only" href="android/win/PDF-Stift-Setup.exe" download="PDF-Stift-Setup.exe" hidden>
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Windows-App installieren
        </a>
        <a id="apkBtn" class="btn primary srv-only" href="android/pdfstift.apk" download="PDF-Stift.apk" hidden>
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Android-App installieren
        </a>
        <button id="btnUpload" type="button" class="btn primary">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span class="up-lbl">PDF hochladen</span>
        </button>
        <button id="btnMerge" type="button" class="btn">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="8" height="11" rx="1"/><rect x="12.5" y="9" width="8" height="11" rx="1"/></svg>Zusammenfügen
        </button>
      </div>
    </div>
    <section id="recentBox" class="recent" hidden>
      <h2 class="sec-h">Zuletzt geöffnet</h2>
      <div id="recent" class="recent-row"></div>
    </section>
    <div id="folders" class="chips"></div>
    <div id="tagBar" class="tag-bar" hidden></div>
    <div id="folderBar" class="folder-bar" hidden>
      <span id="folderInfo" class="muted"></span>
      <button id="btnFolderOffline" type="button" class="text-btn srv-only">Ganzen Ordner offline verfügbar machen</button>
    </div>
    <div id="files" class="files"></div>
    <section id="textHits" class="text-hits" hidden aria-label="Treffer im Text"></section>
    <p id="libEmpty" class="empty" hidden></p>
    <footer class="lib-foot muted">
      <span class="srv-only">Notizen werden automatisch gespeichert und zwischen deinen Geräten abgeglichen. Geöffnete PDFs sind auch offline verfügbar.</span>
      <span class="loc-only">Notizen werden automatisch gespeichert. Alle PDFs liegen als normale Dateien in deinem Ordner <b id="libDir">PDF-Stift</b>.</span>
      <span class="foot-actions">
        <button id="btnNc" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>Nextcloud
        </button>
        <button id="btnShortcut" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/></svg>iPad-Kurzbefehl
        </button>
        <button id="btnBackup" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Gerät &amp; Sicherung
        </button>
        <button id="btnSettings" type="button" class="text-btn">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>Einstellungen
        </button>
        <button id="btnLogout" type="button" class="text-btn srv-only">Abmelden</button>
      </span>
    </footer>
  </main>

  <main id="viewer" class="viewer" hidden>
    <div id="pages" class="pages"></div>
  </main>
  <aside id="toolPanel" class="tool-panel" hidden aria-label="Werkzeuge">
    <div class="tp-head" title="Ziehen: links, rechts oder frei als Fenster"><b>Werkzeuge</b>
      <button id="tpSide" type="button" class="icon-btn" title="Leiste auf die andere Seite" aria-label="Seite wechseln"><svg viewBox="0 0 24 24"><path d="M7 8h12l-3-3M17 16H5l3 3"/></svg></button>
      <button id="tpAll" type="button" class="icon-btn" title="Alle Werkzeuge groß anzeigen" aria-label="Alle Werkzeuge groß anzeigen"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button id="tpClose" type="button" class="icon-btn" title="Leiste schließen" aria-label="Leiste schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="tp-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input id="tpQ" type="search" placeholder="Werkzeug suchen …" autocomplete="off"></div>
    <div id="tpBody" class="tp-body"></div>
    <div id="tpResize" class="tp-resize" title="Breite ändern"></div>
  </aside>
  <aside id="thumbBar" class="thumb-bar" hidden aria-label="Seitenvorschau">
    <div class="th-head">
      <span class="th-title">Seiten</span>
      <button id="thSide" type="button" class="icon-btn" title="Leiste auf die andere Seite" aria-label="Seite wechseln"><svg viewBox="0 0 24 24"><path d="M7 8h12l-3-3M17 16H5l3 3"/></svg></button>
      <button id="thClose" type="button" class="icon-btn" title="Seitenvorschau ausblenden" aria-label="Ausblenden"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div id="thList" class="th-list"></div>
    <div id="thResize" class="th-resize" title="Breite ändern"></div>
  </aside>
  <main id="board" class="board" hidden aria-label="Notizseite (unendliche Tafel)">
    <canvas id="bdCanvas"></canvas><canvas id="bdLive"></canvas>
  </main>
  <input id="imgIn" type="file" accept="image/*" hidden>
  <input id="camIn" type="file" accept="image/*" capture="environment" hidden>
  <div id="pageBadge" class="page-badge num" hidden></div>
  <button id="markBtn" type="button" class="mark-btn" hidden title="Diese Seite auf die Merkliste setzen" aria-label="Seite merken" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg></button>
  <button id="fsBtn" type="button" class="fs-btn" hidden aria-pressed="false" aria-label="Vollbild" title="Vollbild: Leisten ausblenden">
    <svg class="fs-in" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
    <svg class="fs-out" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
  </button>

  <div id="presentPanel" class="present-panel" hidden>
    <div id="presentFavs" class="present-favs" hidden></div>
    <div class="pp-row">
      <button id="ppPrev" type="button" class="icon-btn" aria-label="Vorherige Seite"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span id="ppPage" class="num pp-page"></span>
      <button id="ppNext" type="button" class="icon-btn" aria-label="Nächste Seite"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      <button id="ppPen" type="button" class="icon-btn" aria-label="Stifte zeigen" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg></button>
      <button id="ppLaser" type="button" class="icon-btn" aria-pressed="false" aria-label="Laserpointer" title="Laserpointer: zeigen und einkreisen, verblasst nach 2 Sekunden"><svg viewBox="0 0 24 24" class="laser-ic"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></button>
      <button id="ppLive" type="button" class="icon-btn srv-only" aria-pressed="false" aria-label="Live-Mitschau" title="Live-Mitschau: QR-Code für die Studierenden"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/></svg></button>
      <button id="ppLiveBadge" type="button" class="live-badge srv-only" hidden><i></i><span>LIVE</span></button>
      <button id="ppMirror" type="button" class="icon-btn" aria-pressed="false" aria-label="Spiegeln" title="Spiegeln (Teleprompter am selben Bild)"><svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7L3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/></svg></button>
      <button id="ppUndo" type="button" class="icon-btn" aria-label="Rückgängig"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
      <button id="ppExit" type="button" class="icon-btn" aria-label="Präsentation beenden"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  </div>
</div>

<dialog id="uploadDlg" class="dlg">
  <form method="dialog" id="uploadForm">
    <h2 id="upTitle">PDFs hochladen</h2>
    <label for="upFolder">Ordner</label>
    <input id="upFolder" list="folderList" placeholder="z. B. Mikro oder Rechnungswesen/2026" autocomplete="off">
    <datalist id="folderList"></datalist>
    <label for="upFiles">Dateien</label>
    <input id="upFiles" type="file" accept="application/pdf,.pdf" multiple required>
    <p id="upHint" class="muted small"></p>
    <label class="check" id="upImgRow" hidden><input id="upImgOne" type="checkbox" checked> <span>Fotos/Bilder zu <b>einer</b> PDF zusammenfassen (sonst wird jedes Bild eine eigene PDF)</span></label>
    <p id="upMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="cancel" type="submit" class="btn" formnovalidate>Abbrechen</button>
      <button id="upGo" value="ok" type="button" class="btn primary">Hochladen</button>
    </div>
  </form>
</dialog>

<dialog id="ncDlg" class="dlg">
  <form method="dialog" id="ncForm">
    <h2>Nextcloud verbinden</h2>
    <p class="muted">PDFs, die du in den gewählten Nextcloud-Ordner legst, erscheinen automatisch in PDF-Stift – auch vom PC aus. Unterordner werden zu Veranstaltungen.</p>
    <label for="ncUrl">Adresse deiner Nextcloud</label>
    <input id="ncUrl" type="url" placeholder="https://cloud.example.org" autocomplete="off">
    <label for="ncUser">Benutzername</label>
    <input id="ncUser" autocomplete="off" autocapitalize="off">
    <label for="ncPass">App-Passwort</label>
    <input id="ncPass" type="password" autocomplete="off" placeholder="in Nextcloud: Einstellungen → Sicherheit → App-Passwort erstellen">
    <label for="ncFolder">Ordner in Nextcloud</label>
    <input id="ncFolder" value="PDF-Stift" autocomplete="off">
    <label class="check" hidden><input id="ncExport" type="checkbox"> Beschriftete PDFs automatisch in Nextcloud ablegen (Unterordner „Mit Notizen“)</label>
    <p id="ncMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="ncRemove" type="button" class="btn" hidden>Trennen</button>
      <button value="cancel" type="submit" class="btn" formnovalidate>Schließen</button>
      <button id="ncSave" type="button" class="btn primary">Speichern &amp; abgleichen</button>
    </div>
  </form>
</dialog>

<dialog id="odDlg" class="dlg wide">
  <form method="dialog">
    <h2>OneDrive verbinden</h2>
    <p class="muted">Du meldest dich direkt bei Microsoft an – PDF-Stift sieht dein Passwort nie. Einmalig brauchst du dafür eine eigene „App-Registrierung“ (kostenlos, ca. 5 Minuten, Anleitung in der README):</p>
    <ol class="steps">
      <li><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">entra.microsoft.com</a> → App-Registrierungen → <b>Neue Registrierung</b>, Name „PDF-Stift“, Kontotypen: <b>beliebiges Organisationsverzeichnis und persönliche Microsoft-Konten</b>.</li>
      <li>Authentifizierung → Erweiterte Einstellungen → <b>Öffentliche Clientflows zulassen: Ja</b> → Speichern.</li>
      <li>API-Berechtigungen → Microsoft Graph → Delegiert: <b>Files.ReadWrite</b>, <b>Notes.Read</b> (für OneNote), <b>offline_access</b>, <b>User.Read</b>.</li>
      <li>Unter „Übersicht“ die <b>Anwendungs-ID (Client-ID)</b> kopieren und hier eintragen.</li>
    </ol>
    <label for="odClient">Anwendungs-ID (Client-ID)</label>
    <input id="odClient" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="1a2b3c4d-1234-5678-9abc-def012345678">
    <label for="odFolder">Ordner in OneDrive (leer = ganzes OneDrive)</label>
    <input id="odFolder" autocomplete="off" placeholder="z. B. Lehre">
    <label for="odTenant">Nur für Uni-/Firmenkonten, falls nötig: Verzeichnis-ID (Mandant)</label>
    <input id="odTenant" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="leer lassen = common">
    <div id="odCode" class="od-code" hidden>
      <p>Öffne <a id="odLink" href="https://microsoft.com/devicelogin" target="_blank" rel="noopener">microsoft.com/devicelogin</a> (geht auch am Handy) und gib diesen Code ein:</p>
      <div class="copyrow"><code id="odUserCode" class="user-code"></code><button id="odCopy" type="button" class="btn">Kopieren</button></div>
    </div>
    <p id="odMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="odRemove" type="button" class="btn" hidden>Abmelden</button>
      <button value="cancel" type="submit" class="btn" formnovalidate>Schließen</button>
      <button id="odLogin" type="button" class="btn primary">Bei Microsoft anmelden</button>
    </div>
  </form>
</dialog>

<dialog id="scDlg" class="dlg wide">
  <form method="dialog">
    <h2>iPad: „Teilen → An PDF-Stift senden“</h2>
    <p class="muted">Mit einem Kurzbefehl schickst du PDFs aus jeder App – auch aus iCloud Drive in der Dateien-App – direkt in den Ordner „Eingang“. Einmal einrichten:</p>
    <ol class="steps">
      <li>App <b>Kurzbefehle</b> öffnen → <b>+</b> → oben den Namen auf „An PDF-Stift senden“ ändern.</li>
      <li>Über das ⓘ-Symbol <b>„Im Share-Sheet anzeigen“</b> einschalten; als Eingabe nur <b>PDFs</b> bzw. <b>Dateien</b> zulassen.</li>
      <li>Aktion <b>„Wiederholen mit jedem Objekt“</b> in <i>Kurzbefehleingabe</i> hinzufügen.</li>
      <li>Darin die Aktion <b>„Inhalte von URL abrufen“</b> einfügen, URL: <code id="scUrl"></code></li>
      <li>Dort aufklappen: Methode <b>POST</b>; unter <b>Header</b> einen Eintrag <code>X-PDFStift-Token</code> mit dem Schlüssel unten; Anfragetext <b>Formular</b>, Feld <code>files[]</code> vom Typ <b>Datei</b> = <i>Wiederholungsobjekt</i>, Feld <code>folder</code> (Text) = <code>Eingang</code>.</li>
      <li>Fertig. In jeder App: Teilen → „An PDF-Stift senden“.</li>
    </ol>
    <label for="scToken">Dein Schlüssel</label>
    <div class="copyrow"><input id="scToken" readonly><button type="button" class="btn" data-copy="scToken">Kopieren</button></div>
    <p class="muted">Der Schlüssel erlaubt nur das Hochladen. Wenn er in falsche Hände gerät: neuen erzeugen – der alte gilt dann nicht mehr.</p>
    <div class="dlg-actions">
      <button id="scRenew" type="button" class="btn">Neuen Schlüssel erzeugen</button>
      <button value="ok" class="btn primary">Fertig</button>
    </div>
  </form>
</dialog>

<dialog id="bkDlg" class="dlg">
  <form method="dialog">
    <h2>Gerät, Speicher &amp; Sicherung</h2>
    <h3 class="dlg-sub">Auf diesem Gerät</h3>
    <p id="devInfo" class="muted">…</p>
    <p class="muted small">Jede PDF wird beim ersten Öffnen einmal geladen und bleibt dann auf dem Gerät. Ändert sie sich auf dem Server (anderes Tablet, nächtliches Verkleinern), holt die App die neue Fassung im Hintergrund. Notizen werden ohnehin sofort abgeglichen.</p>
    <label class="check"><input type="radio" name="devMode" value="need"> <span><b>Bei Bedarf laden und behalten</b> (empfohlen)</span></label>
    <label class="check"><input type="radio" name="devMode" value="all"> <span><b>Alle PDFs auf dem Gerät halten</b> – lädt im WLAN nach und nach alles herunter, neue PDFs kommen automatisch dazu</span></label>
    <p id="devApp" class="small"></p>
    <p id="devWinApp" class="small" hidden></p>
    <p id="devWin" hidden><a class="btn primary" href="android/win/PDF-Stift-Setup.exe" download="PDF-Stift-Setup.exe">Windows-App herunterladen und installieren</a></p>
    <p id="devApk" hidden><a class="btn primary" href="android/pdfstift.apk" download="PDF-Stift.apk">Android-App herunterladen und installieren</a></p>
    <div class="dlg-actions">
      <button id="devInstall" type="button" class="btn primary" hidden>Als App installieren</button>
      <button id="devPersist" type="button" class="btn" hidden>Speicher dauerhaft sichern</button>
      <button id="devClear" type="button" class="btn">Alle Kopien vom Gerät entfernen …</button>
    </div>
    <h3 class="dlg-sub">Sicherung in Nextcloud</h3>
    <p class="muted small">Jede Nacht kommt alles, was nur hier auf dem Server liegt, in den Nextcloud-Ordner <b>PDF-Stift-Sicherung</b>: selbst hochgeladene PDFs, alle Notizen, Notizbücher, Bilder, Unterschrift. Nur Neues und Geändertes wird übertragen; Gelöschtes bleibt in der Sicherung erhalten.</p>
    <label class="check"><input id="nbAuto" type="checkbox"> <span>Jede Nacht nach Nextcloud sichern</span></label>
    <p id="nbInfo" class="muted"></p>
    <div class="dlg-actions"><button id="nbCheck" type="button" class="btn">Sicherung prüfen</button><button id="nbRestore" type="button" class="btn">Wiederherstellen …</button><button id="nbNow" type="button" class="btn">Jetzt sichern</button></div>
    <p id="nbCheckInfo" class="small" hidden></p>
    <h3 class="dlg-sub">Anmeldung absichern</h3>
    <p class="muted small">Nach 5 falschen Passwörtern sperrt PDF-Stift weitere Versuche von dieser Internet-Adresse für 5 Minuten, danach jeweils länger (bis 1 Stunde). Mit dem <b>zweiten Faktor</b> braucht man bei jeder neuen Anmeldung zusätzlich einen 6-stelligen Code aus einer Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, 2FAS). Angemeldete Geräte bleiben angemeldet.</p>
    <p id="afInfo" class="muted"></p>
    <div id="afSetup" hidden>
      <p class="small">1. In der Authenticator-App „Konto hinzufügen“ → QR-Code scannen (oder den Schlüssel abtippen):</p>
      <div id="afQr" class="af-qr"></div>
      <p class="small">Schlüssel: <code id="afSecret"></code></p>
      <p class="small">2. Den 6-stelligen Code, den die App jetzt zeigt, hier eingeben:</p>
      <div class="af-row"><input id="afCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"><button id="afConfirm" type="button" class="btn primary">Einschalten</button></div>
    </div>
    <div id="afCodes" hidden>
      <p class="small"><b>Notfall-Codes – jetzt aufschreiben oder ausdrucken!</b> Jeder funktioniert einmal statt des App-Codes, falls das Handy verloren geht. Sie werden nur dieses eine Mal angezeigt.</p>
      <pre id="afList" class="af-list"></pre>
      <div class="dlg-actions"><button id="afCopy" type="button" class="btn">Kopieren</button></div>
    </div>
    <div class="dlg-actions"><button id="afOn" type="button" class="btn" hidden>Zweiten Faktor einrichten …</button><button id="afOff" type="button" class="btn" hidden>Zweiten Faktor ausschalten …</button></div>
    <h3 class="dlg-sub">Notizen sichern</h3>
    <p class="muted">Lädt alle Notizen aller PDFs als eine Datei herunter. Beim Einspielen werden sie zu den vorhandenen hinzugefügt – es geht nichts verloren.</p>
    <div class="dlg-actions col">
      <button id="bkDown" type="button" class="btn primary">Notizen sichern (herunterladen)</button>
      <label class="btn" for="bkFile">Sicherung einspielen …</label>
      <input id="bkFile" type="file" accept="application/json,.json" hidden>
    </div>
    <p id="bkMsg" class="muted"></p>
    <h3 class="dlg-sub">Nächtlicher Cronjob</h3>
    <p class="muted small">Jede Nacht gleicht der Server mit Nextcloud ab, macht große PDFs kleiner und baut den Suchindex für die Volltextsuche auf.</p>
    <p class="muted small"><b>Verkleinern:</b> alle PDFs ab 10 MB. Seiten, Text und Notizen bleiben genau gleich, Bilder behalten mindestens 300 dpi (auch bei starkem Zoom scharf). Ersetzt wird eine Datei nur, wenn sie deutlich kleiner wird und genauso aussieht; das Original bleibt 7 Tage in <code>storage/backup/verkleinert</code>.</p>
    <label class="check"><input id="shAuto" type="checkbox"> Große PDFs verkleinern</label>
    <label class="check" id="shNcRow" hidden><input id="shNc" type="checkbox"> Auch die Originale in Nextcloud durch die kleinere Fassung ersetzen (Nextcloud hebt die alte Fassung unter „Versionen“ auf)</label>
    <p id="shInfo" class="muted"></p>
    <label for="shCli">Cronjob beim Hoster (täglich 3 Uhr), Kommandozeile:</label>
    <div class="copyrow"><input id="shCli" readonly><button type="button" class="btn" data-copy="shCli">Kopieren</button></div>
    <label for="shUrl">… oder, falls dein Hoster nur Adressen aufruft:</label>
    <div class="copyrow"><input id="shUrl" readonly><button type="button" class="btn" data-copy="shUrl">Kopieren</button></div>
    <div class="dlg-actions">
      <button id="shNow" type="button" class="btn">Jetzt sofort verkleinern</button>
      <button value="ok" class="btn">Schließen</button>
    </div>
  </form>
</dialog>


<dialog id="pickDlg" class="dlg">
  <form method="dialog">
    <h2 id="pickTitle">PDFs zusammenfügen</h2>
    <p id="pickText" class="muted">Tippe die PDFs in der gewünschten Reihenfolge an.</p>
    <input id="pickSearch" type="search" placeholder="Suchen …" autocomplete="off">
    <div id="pickList" class="pick-list"></div>
    <label class="btn pick-dev" for="pickFiles">Von diesem Gerät hinzufügen (PDF, Word, Excel, PowerPoint, Bilder) …</label>
    <input id="pickFiles" type="file" multiple hidden accept="application/pdf,.pdf,image/*,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xls,.xlsx,.ods">
    <h3 class="dlg-sub">Auswahl</h3>
    <ol id="pickSel" class="pick-sel"></ol>
    <div id="pickNameRow"><label for="pickName">Name der neuen PDF</label><input id="pickName" autocomplete="off"></div>
    <p id="pickMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Abbrechen</button>
      <button id="pickGo" value="yes" class="btn primary">Zusammenfügen</button>
    </div>
  </form>
</dialog>

<dialog id="stampDlg" class="dlg">
  <form method="dialog">
    <h2>Kopf-/Fußzeile, Seitenzahlen, Wasserzeichen</h2>
    <p class="muted small">Platzhalter: <code>{n}</code> Seite, <code>{N}</code> Seitenzahl gesamt, <code>{datum}</code>, <code>{datei}</code>. Wird fest in die PDF geschrieben (die vorherige Fassung bleibt auf dem Server gesichert).</p>
    <label for="stHead">Kopfzeile (oben in der Mitte)</label><input id="stHead" autocomplete="off">
    <label for="stFoot">Fußzeile (unten links)</label><input id="stFoot" autocomplete="off">
    <label for="stNum">Seitenzahlen</label>
    <select id="stNum"><option value="">keine</option><option value="{n}">1</option><option value="Seite {n} von {N}" selected>Seite 1 von 9</option><option value="{n} / {N}">1 / 9</option></select>
    <label for="stNumPos">Position der Seitenzahl</label>
    <select id="stNumPos"><option value="br">unten rechts</option><option value="bc">unten in der Mitte</option><option value="tr">oben rechts</option></select>
    <label for="stWm">Wasserzeichen (schräg über der Seite)</label><input id="stWm" placeholder="z. B. ENTWURF" autocomplete="off">
    <div class="row2">
      <div><label for="stSize">Schriftgröße</label><input id="stSize" type="number" min="6" max="24" value="9"></div>
      <div><label for="stFrom">ab Seite</label><input id="stFrom" type="number" min="1" value="1"></div>
    </div>
    <p id="stMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Abbrechen</button>
      <button id="stGo" value="yes" class="btn primary">Einfügen</button>
    </div>
  </form>
</dialog>

<dialog id="olDlg" class="dlg">
  <form method="dialog">
    <h2>Lesezeichen</h2>
    <p class="muted small">Antippen springt zur Seite. Änderungen werden in die PDF geschrieben – andere PDF-Programme zeigen die Lesezeichen dann auch.</p>
    <div id="olList" class="ol-list"></div>
    <p id="olMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="olAdd" type="button" class="btn">Lesezeichen für diese Seite …</button>
      <button id="olSave" type="button" class="btn primary" hidden>Änderungen speichern</button>
      <button value="ok" class="btn">Schließen</button>
    </div>
  </form>
</dialog>

<dialog id="convDlg" class="dlg">
  <form method="dialog">
    <h2>Umwandeln</h2>
    <p class="muted small">Notizen werden mit übernommen. Alles passiert auf diesem Gerät.</p>
    <div class="dlg-actions col">
      <button id="cvDocx" type="button" class="btn primary">Word-Datei (.docx) – Text zum Weiterbearbeiten</button>
      <button id="cvDocxImg" type="button" class="btn">Word-Datei (.docx) – Seiten als Bilder, sieht aus wie die PDF</button>
      <button id="cvXlsx" type="button" class="btn">Excel-Datei (.xlsx) – Tabellen und Zahlen, eine Tabelle je Seite</button>
      <button id="cvPptx" type="button" class="btn">PowerPoint (.pptx) – eine Folie je Seite</button>
      <button id="cvJpg" type="button" class="btn">Alle Seiten als Bilder (JPG, als ZIP)</button>
      <button id="cvPng" type="button" class="btn">Diese Seite als Bild (PNG)</button>
      <button id="cvTxt" type="button" class="btn">Nur den Text (.txt)</button>
    </div>
    <p id="cvMsg" class="muted"></p>
    <div class="dlg-actions"><button value="ok" class="btn">Schließen</button></div>
  </form>
</dialog>


<dialog id="sigDlg" class="dlg">
  <form method="dialog">
    <h2>Deine Unterschrift</h2>
    <p class="muted small">Einmal mit Stift oder Finger unterschreiben – sie wird gespeichert und steht dann auf allen Geräten zur Verfügung.</p>
    <canvas id="sigPad" class="sig-pad" width="900" height="300"></canvas>
    <div class="dlg-actions">
      <button id="sigClear" type="button" class="btn">Neu</button>
      <button id="sigReset" type="button" class="btn" title="Gespeicherte Unterschrift löschen">Gespeicherte löschen</button>
      <button value="no" class="btn">Abbrechen</button>
      <button id="sigSave" value="yes" class="btn primary">Speichern und einsetzen</button>
    </div>
  </form>
</dialog>

<dialog id="stDlg" class="dlg">
  <form method="dialog">
    <h2>Stempel</h2>
    <div class="st-opts">
      <div id="stColors" class="st-colors" aria-label="Farbe">
        <button type="button" data-c="auto" title="Farbe des Stempels">Auto</button>
        <button type="button" data-c="#C81E1E" style="--c:#C81E1E" aria-label="Rot"></button>
        <button type="button" data-c="#1F8A4C" style="--c:#1F8A4C" aria-label="Grün"></button>
        <button type="button" data-c="#1E4FB8" style="--c:#1E4FB8" aria-label="Blau"></button>
        <button type="button" data-c="#C2410C" style="--c:#C2410C" aria-label="Orange"></button>
        <button type="button" data-c="#7E3AC7" style="--c:#7E3AC7" aria-label="Lila"></button>
        <button type="button" data-c="#1B1F29" style="--c:#1B1F29" aria-label="Schwarz"></button>
      </div>
      <div class="row2">
        <div><label for="stName">Name / Kürzel (optional)</label><input id="stName" autocomplete="off" placeholder="z. B. Dr. Muster"></div>
        <div><label for="stNote">Bemerkung (optional)</label><input id="stNote" autocomplete="off" placeholder="z. B. Az. 2026/114"></div>
      </div>
      <label class="check"><input id="stWhen" type="checkbox"> <span>Datum und Uhrzeit hinzufügen</span></label>
    </div>
    <div id="stList" class="stamp-list"></div>
    <label for="stOwn">Eigener Stempel</label>
    <div class="copyrow"><input id="stOwn" placeholder="z. B. Bezahlt am {datum}" autocomplete="off"><button id="stOwnGo" type="button" class="btn">Einsetzen</button></div>
    <div class="dlg-actions"><button value="no" class="btn">Schließen</button></div>
  </form>
</dialog>

<dialog id="fbDlg" class="dlg">
  <form method="dialog">
    <h2>Neues Formularfeld</h2>
    <label for="fbType">Art</label>
    <select id="fbType"><option value="text">Textfeld (eine Zeile)</option><option value="multi">Textfeld (mehrere Zeilen)</option><option value="check">Kontrollkästchen</option><option value="choice">Auswahlliste</option></select>
    <label for="fbName">Name des Felds</label><input id="fbName" autocomplete="off">
    <div id="fbOptRow"><label for="fbOpts">Auswahlmöglichkeiten (durch Komma getrennt)</label><input id="fbOpts" autocomplete="off" placeholder="z. B. ja, nein, vielleicht"></div>
    <div class="dlg-actions">
      <button value="no" class="btn">Verwerfen</button>
      <button value="yes" class="btn primary">Feld anlegen</button>
    </div>
  </form>
</dialog>

<dialog id="cmpDlg" class="dlg">
  <form method="dialog">
    <h2>Vergleichen</h2>
    <p class="muted small">Womit soll die geöffnete PDF verglichen werden?</p>
    <div id="cmpVers" class="pick-list"></div>
    <div class="dlg-actions">
      <button id="cmpOther" type="button" class="btn">Andere PDF wählen …</button>
      <button value="no" class="btn">Abbrechen</button>
    </div>
  </form>
</dialog>

<dialog id="askDlg" class="dlg">
  <form method="dialog">
    <h2 id="askTitle">Name</h2>
    <p id="askText" class="muted"></p>
    <label for="askInput" class="sr">Name</label>
    <input id="askInput" list="folderList" autocomplete="off" autocapitalize="off">
    <p id="askMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Abbrechen</button>
      <button value="yes" class="btn primary" id="askYes">OK</button>
    </div>
  </form>
</dialog>

<dialog id="confirmDlg" class="dlg">
  <form method="dialog">
    <h2 id="confirmTitle">Sicher?</h2>
    <p id="confirmText" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Abbrechen</button>
      <button value="yes" class="btn danger" id="confirmYes">Löschen</button>
    </div>
  </form>
</dialog>

<dialog id="onDlg" class="dlg">
  <form method="dialog">
    <h2>Aus OneNote übernehmen</h2>
    <p class="muted">Jede OneNote-Seite wird zu einer Notizseite mit Text, Bildern, Tabellen und deiner Handschrift – alles bleibt bearbeitbar. Notizbücher und Abschnitte bleiben gleich geordnet. Schon übernommene Seiten werden übersprungen.</p>
    <div id="onList" class="on-list"></div>
    <label class="check"><input id="onUpd" type="checkbox"> Auch Seiten neu übernehmen, die in OneNote seitdem geändert wurden (ersetzt deine Änderungen an diesen Seiten in PDF-Stift)</label>
    <p id="onMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="cancel" class="btn">Abbrechen</button>
      <button id="onGo" type="button" class="btn primary">Übernehmen</button>
    </div>
  </form>
</dialog>

<div id="importBar" class="ocr-bar" hidden role="status"><span class="spin" aria-hidden="true"></span><span id="importText"></span><button id="importStop" type="button" class="text-btn">Anhalten</button></div>

<div id="tbDrop" class="tb-drop" hidden></div>
<div id="peBar" class="pe-bar" hidden>
  <span id="peText"></span>
  <span id="peExtra" class="pe-extra"></span>
  <button id="peApply" type="button" class="btn primary" hidden>Schwärzen anwenden</button>
  <button id="peDone" type="button" class="btn">Fertig</button>
</div>


<div id="livePanel" class="live-panel" hidden role="dialog" aria-label="Live-Mitschau">
  <div class="lv-qr" id="lvQr"></div>
  <div class="lv-side">
    <div class="lv-live"><i></i>LIVE-MITSCHAU</div>
    <p class="lv-big">Handy-Kamera auf den QR-Code richten</p>
    <p class="lv-url"><span id="lvUrl"></span></p>
    <p class="muted">oder auf <b>live.php</b> den Code eingeben: <b id="lvCode" class="lv-code"></b></p>
    <p id="lvCount" class="muted"></p>
    <p class="muted small">Die Studierenden sehen nur die gerade gezeigte Seite mit deinen Notizen – ohne Anmeldung, ohne Herunterladen.</p>
    <div class="dlg-actions">
      <button id="lvCopy" type="button" class="btn">Link kopieren</button>
      <button id="lvStop" type="button" class="btn danger">Beenden</button>
      <button id="lvHide" type="button" class="btn primary">QR-Code ausblenden</button>
    </div>
  </div>
</div>

<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

<script src="vendor/pdf-lib.min.js?v=<?= $v ?>"></script>
<script src="vendor/qrcode.js?v=<?= $v ?>"></script>
<script src="vendor/fflate.min.js?v=<?= $v ?>"></script>
<script type="module">
import * as pdfjs from './vendor/pdfjs/pdf.min.js?v=<?= $v ?>';
// pdf.js 6: Schriftdaten (Standardschriften, Zeichentabellen), Bild-Dekoder und Farbprofile liegen daneben
const B = new URL('vendor/pdfjs/', location.href).href;
const OPT = { cMapUrl: B + 'cmaps/', cMapPacked: true, standardFontDataUrl: B + 'standard_fonts/', wasmUrl: B + 'wasm/', iccUrl: B + 'iccs/', isEvalSupported: false };
// pdf.js 6: Dokumente haben kein destroy() mehr – wie früher anbieten (beendet die Ladeaufgabe)
window.pdfjsLib = Object.assign({}, pdfjs, { getDocument: (src) => {
  const task = pdfjs.getDocument(Object.assign({}, OPT, typeof src === 'string' || src instanceof URL ? { url: String(src) } : src));
  task.promise.then((doc) => { if (typeof doc.destroy !== 'function') doc.destroy = () => task.destroy(); }, () => {});
  return task;
} });
</script>
<script defer src="app/app.js?v=<?= $v ?>"></script>
</body>
</html>
