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
<html lang="en">
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
<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" type="image/png" sizes="32x32">
<link rel="shortcut icon" href="favicon.ico">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="stylesheet" href="app/app.css?v=<?= $v ?>">
<script>try { var t = JSON.parse(localStorage.getItem('pdfstift.theme')); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}</script>
</head>
<body data-ed="<?= edition() ?>"<?= $demo ? ' data-demo="1"' : '' ?>>

<section id="auth" class="auth" hidden>
  <form id="authForm" class="auth-card">
    <div class="brand"><img src="icons/icon.svg" alt="" width="40" height="40"><span>PDF-Stift</span></div>
    <h1 id="authTitle">Sign in</h1>
    <p id="authText" class="muted">Enter your password.</p>
    <label for="pw">Password</label>
    <input id="pw" type="password" autocomplete="current-password" required minlength="1"<?= $demo ? ' value="' . htmlspecialchars($demo['password']) . '"' : '' ?>>
<?php if ($demo): ?>
    <p class="demo-note">Public demo – the password “<b><?= htmlspecialchars($demo['password']) ?></b>” is already filled in. Just tap “Sign in”.</p>
<?php endif; ?>
    <div id="codeRow" hidden>
      <label for="code2">Code from the authenticator app</label>
      <input id="code2" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="6 digits or recovery code">
    </div>
    <button type="submit" class="btn primary" id="authBtn">Sign in</button>
    <p id="authErr" class="err" role="alert"></p>
  </form>
</section>

<?php if ($demo): ?>
<div id="demoBar" class="demo-bar" role="note"><b>Demo</b><span>Reset every hour on the hour – please don’t upload personal files.</span><?php if ($demo['credit'] !== ''): ?><span class="muted"><?= htmlspecialchars($demo['credit']) ?></span><?php endif; ?><a href="https://github.com/ek1-wq/pdf-stift/releases/latest" target="_blank" rel="noopener">Download for free</a></div>
<?php endif; ?>
<div id="shell" class="shell" hidden>
  <header class="topbar">
    <button id="btnLib" class="icon-btn" type="button" aria-label="My PDFs" title="My PDFs">
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>
    </button>
    <nav id="tabs" class="tabs" role="tablist" aria-label="Open PDFs"></nav>
    <button id="liveBadge" type="button" class="live-badge srv-only" hidden><i></i><span>LIVE</span></button>
    <div id="viewRow" class="view-row">
      <div id="viewBar" class="view-bar" role="toolbar" aria-label="View and edit" hidden>
        <span class="menu-wrap vb-grip-wrap"><button id="vbGrip" type="button" class="tb-grip vb-grip" aria-label="Move toolbar" title="Move toolbar: drag to an edge – or tap"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></button></span>
        <button type="button" class="vb-b vb-x" data-vb="save" title="Save with notes (Ctrl+S)" aria-label="Save"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg></button>
        <button type="button" class="vb-b vb-x" data-vb="print" title="Print (Ctrl+P)" aria-label="Print"><svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6H7z"/></svg></button>
        <span class="vb-sep vb-x"></span>
        <span class="vb-seg">
          <button type="button" class="vb-b" data-vb="single" title="Single pages, one below the other" aria-label="Single pages"><svg viewBox="0 0 24 24"><rect x="7" y="3.5" width="10" height="17" rx="1.5"/></svg></button>
          <button type="button" class="vb-b" data-vb="two" title="Two pages side by side" aria-label="Two pages side by side"><svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="8.5" height="14" rx="1.2"/><rect x="13" y="5" width="8.5" height="14" rx="1.2"/></svg></button>
          <button type="button" class="vb-b" data-vb="cover" title="Like a book: cover page alone, then two pages each" aria-label="Book view"><svg viewBox="0 0 24 24"><path d="M12 6.5C10 5 6.5 4.5 3 5v13.5c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V5c-3.5-.5-7 0-9 1.5zM12 6.5V20"/></svg></button>
        </span>
        <button type="button" class="vb-b" data-vb="split" title="Two documents side by side (a second PDF on the right)" aria-label="Two documents side by side"><svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="1.5"/><path d="M12 4v16"/><path d="M5 8h4M5 11h4M15 8h4M15 11h4M15 14h3"/></svg></button>
        <span class="vb-sep"></span>
        <button type="button" class="vb-b" data-vb="fitw" title="Fit width (Ctrl+2)" aria-label="Fit width"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M7 12h10M7 12l2.5-2.5M7 12l2.5 2.5M17 12l-2.5-2.5M17 12l-2.5 2.5"/></svg></button>
        <button type="button" class="vb-b" data-vb="fitp" title="Whole page (Ctrl+0)" aria-label="Fit page"><svg viewBox="0 0 24 24"><rect x="6.5" y="3.5" width="11" height="17" rx="1.5"/><path d="M9.5 8.5V7h5v1.5M9.5 15.5V17h5v-1.5"/></svg></button>
        <button type="button" class="vb-b" data-vb="zout" title="Zoom out (Ctrl+−)" aria-label="Zoom out"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5"/></svg></button>
        <button type="button" class="vb-b" data-vb="zin" title="Zoom in (Ctrl++)" aria-label="Zoom in"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5M11 8.5v5"/></svg></button>
        <button type="button" class="vb-b vb-x" data-vb="rotL" title="Rotate view counterclockwise" aria-label="Rotate view counterclockwise"><svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.05-4.95M5 4v4h4"/></svg></button>
        <button type="button" class="vb-b" data-vb="rotR" title="Rotate view clockwise" aria-label="Rotate view clockwise"><svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"/></svg></button>
        <span class="vb-sep"></span>
        <button type="button" class="vb-b" data-vb="undo" id="vbUndo" title="Undo (Ctrl+Z)" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <button type="button" class="vb-b" data-vb="redo" id="vbRedo" title="Redo (Ctrl+Y)" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
        <button type="button" class="vb-b" data-vb="find" title="Find in PDF (Ctrl+F)" aria-label="Search in PDF"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg></button>
        <span class="vb-sep vb-x"></span>
        <button type="button" class="vb-b vb-x" data-vb="focus" title="Hide bars – page only (Ctrl+H)" aria-label="Hide toolbars"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      </div>
      <span class="vr-sp"></span>
      <button id="thBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Show/hide page thumbnails next to the PDF" hidden>
        <svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M15 4v16"/><path d="M17 8h1.5M17 12h1.5M17 16h1.5"/></svg>
        <span>Pages</span>
      </button>
      <button id="cmBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Comments: all sticky notes in this PDF as a list" hidden>
        <svg viewBox="0 0 24 24"><path d="M5 5h14v10H10l-4 4v-4H5z"/></svg>
        <span>Comments</span>
      </button>
      <button id="toolsBtn" type="button" class="text-btn present-btn" title="Tools: Edit, Forms, Signature, Convert, Protect …">
        <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/></svg>
        <span>Tools</span>
      </button>
      <button id="presentBtn" type="button" class="text-btn present-btn" aria-pressed="false" title="Presentation: show only the page – for projectors and screen mirroring" hidden>
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/></svg>
        <span>Presentation</span>
      </button>
      <button id="vrCfg" type="button" class="vb-b vr-cfg" title="Customize toolbar" aria-label="Customize toolbar"><svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>
    </div>
    <button id="srvUpd" type="button" class="upd-pill srv-pill srv-only" hidden title="New version for the server – install with one click"><span class="upd-dot"></span><span id="srvUpdText">Server update</span></button>
    <button id="bkWarn" type="button" class="bk-warn srv-only" hidden title="Something is wrong with the backup – tap for details"><span>⚠︎</span><span id="bkWarnText">Backup</span></button>
    <button id="winUpd" type="button" class="upd-pill" hidden><span class="upd-dot"></span><span id="winUpdText">Update available</span></button>
    <button id="themeBtn" type="button" class="theme-btn" title="Light or dark theme" aria-label="Light or dark theme">
      <svg class="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>
      <svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>
    </button>
    <div class="ocr-wrap">
      <button id="ocrInd" type="button" class="ocr-ind" data-state="idle" aria-haspopup="true" aria-expanded="false" title="Text recognition (make scans searchable)">
        <span class="led" aria-hidden="true"></span><span class="ocr-lbl">OCR</span>
        <span id="ocrCount" class="ocr-count"></span>
      </button>
      <div id="ocrPop" class="ocr-pop" hidden role="dialog" aria-label="Text recognition">
        <div class="op-head"><b>Text recognition</b><span class="muted small">makes scans searchable and highlightable</span></div>
        <div id="opStatus" class="op-status"></div>
        <div class="op-prog" hidden><i id="opBar"></i></div>
        <label class="check op-auto"><input id="opAuto" type="checkbox"> <span>Recognize scans automatically<br><span class="muted small">when opening a scan, in the background</span></span></label>
        <div class="op-btns"><button id="opNow" type="button" class="btn">Recognize this PDF now</button><button id="opStop" type="button" class="btn">Pause</button></div>
      </div>
    </div>
    <div id="sync" class="sync" data-state="ok" title="">
      <span class="dot"></span><span id="syncText">Saved</span>
    </div>
  </header>

  <div id="dockT" class="dock dock-h">
  <div id="toolbar" class="toolbar" hidden>
    <div class="tb-row">
      <div class="menu-wrap tb-grip-wrap">
        <button id="tbGrip" type="button" class="tb-grip" aria-label="Move toolbar" title="Move toolbar: drag to an edge – or tap">
          <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
        </button>
      </div>
      <div id="favs" class="favs" aria-label="Favorites"></div>
      <button id="favAdd" type="button" class="icon-btn" aria-label="Save current tool as favorite" title="Save as favorite">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <span class="sep"></span>
      <button id="toolsToggle" type="button" class="text-btn" aria-expanded="true" aria-controls="toolsRow" title="Show/hide pens, colors and widths">
        <svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
        <span>Pens</span>
      </button>
      <div class="spacer"></div>
      <div class="group">
        <button id="undo" type="button" class="icon-btn" aria-label="Undo" title="Undo">
          <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </button>
        <button id="redo" type="button" class="icon-btn" aria-label="Redo" title="Redo">
          <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </button>
      </div>
      <span class="sep"></span>
      <div class="group">
        <button id="zoomOut" type="button" class="icon-btn" aria-label="Zoom out"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
        <button id="zoomFit" type="button" class="text-btn num" aria-label="Fit width">100 %</button>
        <button id="zoomIn" type="button" class="icon-btn" aria-label="Zoom in"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
      <span class="sep"></span>
      <button id="searchBtn" type="button" class="icon-btn" aria-label="Search in PDF" title="Search in PDF" aria-expanded="false">
        <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>
      </button>
      <button id="overviewBtn" type="button" class="icon-btn" aria-label="Page overview" title="Page overview">
        <svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="6.5" height="8" rx="1"/><rect x="13.5" y="3.5" width="6.5" height="8" rx="1"/><rect x="4" y="13.5" width="6.5" height="7" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="7" rx="1"/></svg>
      </button>
      <div class="menu-wrap">
      <button id="bdImgBtn" type="button" class="icon-btn" aria-label="Take photo or insert image" title="Take photo or insert image">
        <svg viewBox="0 0 24 24"><path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/></svg>
      </button>
      </div>
      <button id="finger" type="button" class="icon-btn" aria-pressed="false" aria-label="Draw with finger" title="Draw with finger (for devices without a pen)">
        <svg viewBox="0 0 24 24"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M12 10V4a1.5 1.5 0 0 1 3 0v7"/><path d="M15 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.7-2.3L4 14.5a1.5 1.5 0 0 1 2.3-1.9L9 15"/></svg>
      </button>
      <div class="menu-wrap">
        <button id="menuBtn" type="button" class="icon-btn" aria-label="More" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>
        </button>
        <div id="menu" class="menu" hidden>
          <button type="button" data-act="bd-fit" class="bd-only">Show whole page</button>
          <button type="button" data-act="bd-img" class="bd-only">Insert image …</button>
          <button type="button" data-act="bd-pdf" class="bd-only">Insert PDF pages …</button>
          <button type="button" data-act="bd-tpl" class="bd-only">Insert template (Cornell, meeting, lecture) …</button>
          <button type="button" data-act="link" class="bd-only">Insert link …</button>
          <button type="button" data-act="backlinks" class="bd-only">What links here? …</button>
          <button type="button" data-act="bd-hist" class="bd-only">Earlier versions …</button>
          <button type="button" data-act="bd-save" class="bd-only">Save as PDF …</button>
          <button type="button" data-act="bd-print" class="bd-only">Print …</button>
          <span class="menu-sep bd-only"></span>
          <button type="button" data-act="bg-dots" class="bd-only">Background: Dots</button>
          <button type="button" data-act="bg-grid" class="bd-only">Background: Grid</button>
          <button type="button" data-act="bg-lines" class="bd-only">Background: Lined</button>
          <button type="button" data-act="bg-plain" class="bd-only">Background: Blank</button>
          <button type="button" data-act="export">Download PDF with notes</button>
          <button type="button" data-act="original">Download original</button>
          <button type="button" data-act="ncput" class="nc-only" hidden>Save to Nextcloud with notes</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="ins-blank">Insert blank page after this one</button>
          <button type="button" data-act="ins-grid">Insert grid page after this one</button>
          <button type="button" data-act="ins-lines">Insert lined page after this one</button>
          <button type="button" data-act="rotate">Rotate this page</button>
          <button type="button" data-act="delpage">Delete this page …</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="tools"><b>All tools …</b></button>
          <button type="button" data-act="tags">Tags …</button>
          <button type="button" data-act="link">Insert link to another page …</button>
          <button type="button" data-act="backlinks">What links to this PDF? …</button>
          <button type="button" data-act="paste">Paste from clipboard (text or image)</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="ocr">Recognize text (make scan searchable)</button>
          <button type="button" data-act="scanfix">Clean up scans (straighten, blank pages, contrast) …</button>
          <button type="button" data-act="handout">Create handouts …</button>
          <button type="button" data-act="findredact">Find and redact …</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="live" class="srv-only">Live view for students (QR code) …</button>
          <button type="button" data-act="resetfavs">Reset favorites</button>
          <span class="menu-sep"></span>
          <button type="button" data-act="two">Two pages side by side / single pages</button>
          <button type="button" data-act="vbcfg">Customize toolbar …</button>
          <button type="button" data-act="viewrot">Rotate view (display only)</button>
          <button type="button" data-act="mkf">Add slide marker</button>
          <button type="button" data-act="study">Study sheet from highlights …</button>
          <button type="button" data-act="tonb">Copy to notebook …</button>
          <button type="button" data-act="carry">Take over notes from an older version …</button>
          <button type="button" data-act="props">Document properties …</button>
          <button type="button" data-act="settings"><b>Settings …</b></button>
          <button type="button" data-act="report" class="srv-only">Improvement report …</button>
          <button type="button" data-act="help">Quick guide</button>
          <button type="button" data-act="about">About PDF-Stift …</button>
        </div>
      </div>
    </div>

    <div id="searchRow" class="tb-row search-row" hidden>
      <label for="q" class="sr">Search in PDF</label>
      <input id="q" type="search" placeholder="Search in PDF …" autocomplete="off" enterkeyhint="search">
      <span id="qInfo" class="muted num"></span>
      <button id="qPrev" type="button" class="icon-btn" aria-label="Previous match"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
      <button id="qNext" type="button" class="icon-btn" aria-label="Next match"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      <button id="qClose" type="button" class="icon-btn" aria-label="Close search"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  </div>
  <div id="toolbar2" class="toolbar toolbar2" hidden>
    <div class="menu-wrap tb-grip-wrap">
      <button id="tb2Grip" type="button" class="tb-grip" aria-label="Move tool bar" title="Move toolbar: drag to an edge – or tap">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
      </button>
    </div>
    <div id="toolsRow" class="tb-row tools-row">
      <div class="group seg" role="radiogroup" aria-label="Tool">
        <button type="button" class="tool" data-tool="sel" aria-label="Select text" title="Select and copy text (right-click: highlight, copy …)">
          <svg viewBox="0 0 24 24"><path d="M5 3.5l13 7.2-5.6 1.4L9.8 18z"/><path d="M12.6 12.4l4.6 6.1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="hand" aria-label="Hand" title="Hand: move the page with the mouse (or hold Space)">
          <svg viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5"/><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.2 7-2.6 0-4-1.2-5.4-3.2L3.7 13a1.4 1.4 0 0 1 2.2-1.7L8 13.5"/></svg>
        </button>
        <button type="button" class="tool" data-tool="pen" aria-label="Pen" title="Pen">
          <svg viewBox="0 0 24 24"><path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg>
        </button>
        <button type="button" class="tool" data-tool="hl" aria-label="Highlighter (freehand)" title="Highlighter (freehand)">
          <svg viewBox="0 0 24 24"><path d="M9 15l-3 3H3l3-3"/><path d="M9 15l9-9 3 3-9 9z"/><path d="M3 21h9"/></svg>
        </button>
        <button type="button" class="tool" data-tool="tx" aria-label="Highlight text" title="Highlight text (snaps to text)">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="1.5" fill="currentColor" opacity=".18" stroke="none"/><path d="M8 15l4-9 4 9M9.6 12h4.8"/><path d="M4 20h16"/></svg>
        </button>
        <button type="button" class="tool" data-tool="sh" aria-label="Shapes" title="Line, arrow, rectangle, circle">
          <svg viewBox="0 0 24 24"><path d="M4 20L13 11"/><path d="M8.5 11H13v4.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="tt" aria-label="Text box" title="Text box: tap the page and type">
          <svg viewBox="0 0 24 24"><path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/></svg>
        </button>
        <button type="button" class="tool" data-tool="nt" aria-label="Comment" title="Comment: place a sticky note on the page">
          <svg viewBox="0 0 24 24"><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M7.5 9h9M7.5 12h6"/></svg>
        </button>
        <button type="button" class="tool" data-tool="la" aria-label="Lasso" title="Lasso: circle notes, then move, recolor or delete them">
          <svg viewBox="0 0 24 24"><path d="M12 4c5 0 8.5 2.3 8.5 5.2S17 14.5 12 14.5 3.5 12.2 3.5 9.2 7 4 12 4z" stroke-dasharray="3 2.4"/><path d="M6.5 13.5c-1 1.5-.4 3.4 1.6 3.6 1.8.2 2.1 2 .9 3.4"/></svg>
        </button>
        <button type="button" class="tool" data-tool="lp" aria-label="Laser pointer" title="Laser pointer: point and circle – fades after 2 seconds, not saved">
          <svg viewBox="0 0 24 24" class="laser-ic"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>
        </button>
        <button type="button" class="tool" data-tool="er" aria-label="Eraser" title="Eraser">
          <svg viewBox="0 0 24 24"><path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.5z"/><path d="M9.5 10.5l5 5"/></svg>
        </button>
      </div>
      <div id="txKinds" class="group seg" aria-label="Text markup type">
        <button type="button" class="kind" data-k="hl" aria-label="Highlight" title="Highlight"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="15" rx="2" fill="currentColor" opacity=".22" stroke="none"/><path d="M8 16l4-9 4 9M9.6 13h4.8"/></svg></button>
        <button type="button" class="kind" data-k="ul" aria-label="Underline" title="Underline"><svg viewBox="0 0 24 24"><path d="M8 15l4-9 4 9M9.6 12h4.8"/><path d="M5 19.5h14"/></svg></button>
        <button type="button" class="kind" data-k="st" aria-label="Strike through" title="Strike through"><svg viewBox="0 0 24 24"><path d="M8 18l4-12 4 12M9.3 14h5.4"/><path d="M5 11h14"/></svg></button>
      </div>
      <div id="shKinds" class="group seg" aria-label="Shape">
        <button type="button" class="kind" data-k="line" aria-label="Line" title="Line"><svg viewBox="0 0 24 24"><path d="M5 19L19 5"/></svg></button>
        <button type="button" class="kind" data-k="arrow" aria-label="Arrow" title="Arrow"><svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><path d="M10 5h9v9"/></svg></button>
        <button type="button" class="kind" data-k="rect" aria-label="Rectangle" title="Rectangle"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/></svg></button>
        <button type="button" class="kind" data-k="oval" aria-label="Circle" title="Circle / ellipse"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg></button>
      </div>
      <div id="ttSizes" class="group seg" aria-label="Font size">
        <button type="button" class="kind" data-fs="9" aria-label="Small" title="Small (9 pt)"><span class="fsz" style="font-size:12px">A</span></button>
        <button type="button" class="kind" data-fs="14" aria-label="Medium" title="Medium (14 pt)"><span class="fsz" style="font-size:16px">A</span></button>
        <button type="button" class="kind" data-fs="22" aria-label="Large" title="Large (22 pt)"><span class="fsz" style="font-size:21px">A</span></button>
      </div>
      <span class="sep"></span>
      <div id="colors" class="group colors" aria-label="Color"></div>
      <span class="sep"></span>
      <div id="widths" class="group" aria-label="Stroke width"></div>
    </div>
  </div>
  <div id="obRibbon" class="ob-ribbon rb-band" role="toolbar" aria-label="Insert and format" hidden>
    <div class="menu-wrap tb-grip-wrap rb-grip-wrap">
      <button id="rbGrip" type="button" class="tb-grip" aria-label="Move ribbon" title="Move ribbon: drag to an edge – or tap">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
      </button>
    </div>
    <div class="rb-fmt"></div>
  </div>
  </div>
  <div id="dockL" class="dock dock-v"></div>
  <div id="dockR" class="dock dock-v"></div>
  <div id="dockB" class="dock dock-h"></div>

  <section id="overview" class="overview" hidden aria-label="Page overview">
    <div class="ov-head">
      <div class="seg2" role="tablist">
        <button type="button" data-f="all" class="active" role="tab">All pages</button>
        <button type="button" data-f="notes" role="tab">With annotations</button>
      </div>
      <p id="ovHint" class="muted small ov-hint">Drag pages to reorder (with a finger: press and hold briefly)</p>
      <div class="ov-acts">
        <button id="ovIns" type="button" class="btn">Insert PDF …</button>
        <button id="ovSplit" type="button" class="btn">Extract / split …</button>
        <button id="ovSelBtn" type="button" class="btn">Select</button>
        <span id="ovSelActs" class="ov-selacts" hidden>
          <span id="ovSelN" class="muted small"></span>
          <button type="button" class="btn" data-ov="all">Select all</button>
          <button type="button" class="btn" data-ov="rot">Rotate</button>
          <button type="button" class="btn" data-ov="ext">As new PDF</button>
          <button type="button" class="btn" data-ov="del">Delete</button>
        </span>
        <button id="ovClose" type="button" class="btn">Close</button>
      </div>
    </div>
    <div id="ovGrid" class="ov-grid"></div>
    <p id="ovEmpty" class="empty" hidden>No page has annotations yet.</p>
  </section>

  <section id="toolsView" class="tools-view" hidden aria-label="Tools">
    <div class="ov-head">
      <h2 class="tv-title">Tools <span id="tvDoc" class="muted small"></span></h2>
      <button id="tvClose" type="button" class="btn">Close</button>
    </div>
    <div id="tvBody" class="tv-body"></div>
  </section>

  <section id="cmpView" class="tools-view" hidden aria-label="Comparison">
    <div class="ov-head">
      <div><h2 class="tv-title">Comparison</h2><p id="cmpSum" class="muted small"></p></div>
      <div class="ov-acts">
        <button id="cmpRestore" type="button" class="btn" hidden>Restore this earlier version …</button>
        <button id="cmpClose" type="button" class="btn">Close</button>
      </div>
    </div>
    <div id="cmpBody" class="cmp-body"></div>
  </section>

  <main id="library" class="library">
    <div class="lib-head">
      <div class="lib-title">
        <div class="eyebrow">PDF-Stift</div>
        <h1 id="libTitle">My PDFs</h1>
        <div id="srcSwitch" class="seg2 src-switch" role="tablist" aria-label="Source">
          <button type="button" data-src="local" role="tab" class="active">
            <svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>My PDFs
          </button>
          <button type="button" data-src="nb" role="tab">
            <svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M3.5 7H6M3.5 12H6M3.5 17H6"/></svg>Notebook
          </button>
          <button type="button" data-src="dk" role="tab">
            <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="12" rx="1.5"/><path d="M12 16.5V20M8.5 20h7"/><path d="M8 11.5l2.5-2.5 2 2 3-3.5"/></svg>Presentations
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
        <label for="search" class="sr">Search</label>
        <input id="search" type="search" placeholder="Search …" autocomplete="off">
        <a id="winBtn" class="btn primary srv-only" href="android/win/PDF-Stift-Setup.exe" download="PDF-Stift-Setup.exe" hidden>
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Install Windows app
        </a>
        <a id="apkBtn" class="btn primary srv-only" href="android/pdfstift.apk" download="PDF-Stift.apk" hidden>
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Install Android app
        </a>
        <button id="btnUpload" type="button" class="btn primary">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span class="up-lbl">Upload PDF</span>
        </button>
        <button id="btnMerge" type="button" class="btn">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="8" height="11" rx="1"/><rect x="12.5" y="9" width="8" height="11" rx="1"/></svg>Combine
        </button>
      </div>
    </div>
    <section id="recentBox" class="recent" hidden>
      <h2 class="sec-h">Recently opened</h2>
      <div id="recent" class="recent-row"></div>
    </section>
    <div id="folders" class="chips"></div>
    <div id="tagBar" class="tag-bar" hidden></div>
    <div id="folderBar" class="folder-bar" hidden>
      <span id="folderInfo" class="muted"></span>
      <button id="btnFolderOffline" type="button" class="text-btn srv-only">Make whole folder available offline</button>
    </div>
    <div id="files" class="files"></div>
    <section id="textHits" class="text-hits" hidden aria-label="Matches in text"></section>
    <p id="libEmpty" class="empty" hidden></p>
    <footer class="lib-foot muted">
      <span class="srv-only">Notes are saved automatically and synced between your devices. Opened PDFs are also available offline.</span>
      <span class="loc-only">Notes are saved automatically. All PDFs are plain files in your folder <b id="libDir">PDF-Stift</b>.</span>
      <span class="foot-actions">
        <button id="btnNc" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>Nextcloud
        </button>
        <button id="btnShortcut" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/></svg>iPad shortcut
        </button>
        <button id="btnBackup" type="button" class="text-btn srv-only">
          <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>Device &amp; backup
        </button>
        <button id="btnSettings" type="button" class="text-btn">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>Settings
        </button>
        <button id="btnLogout" type="button" class="text-btn srv-only">Sign out</button>
      </span>
    </footer>
  </main>

  <main id="viewer" class="viewer" hidden>
    <div id="pages" class="pages"></div>
  </main>
  <aside id="toolPanel" class="tool-panel" hidden aria-label="Tools">
    <div class="tp-head" title="Drag: dock left, right or float as a window"><b>Tools</b>
      <button id="tpSide" type="button" class="icon-btn" title="Move bar to the other side" aria-label="Switch side"><svg viewBox="0 0 24 24"><path d="M7 8h12l-3-3M17 16H5l3 3"/></svg></button>
      <button id="tpAll" type="button" class="icon-btn" title="Show all tools large" aria-label="Show all tools large"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button id="tpClose" type="button" class="icon-btn" title="Close panel" aria-label="Close panel"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="tp-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input id="tpQ" type="search" placeholder="Search tools …" autocomplete="off"></div>
    <div id="tpBody" class="tp-body"></div>
    <div id="tpResize" class="tp-resize" title="Resize"></div>
  </aside>
  <aside id="thumbBar" class="thumb-bar" hidden aria-label="Page thumbnails">
    <div class="th-head">
      <span class="th-title">Pages</span>
      <button id="thSide" type="button" class="icon-btn" title="Move bar to the other side" aria-label="Switch side"><svg viewBox="0 0 24 24"><path d="M7 8h12l-3-3M17 16H5l3 3"/></svg></button>
      <button id="thClose" type="button" class="icon-btn" title="Hide page thumbnails" aria-label="Hide"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div id="thList" class="th-list"></div>
    <div id="thResize" class="th-resize" title="Resize"></div>
  </aside>
  <main id="deckView" class="deck-view" hidden aria-label="Presentation"></main>
  <main id="board" class="board" hidden aria-label="Note page (infinite canvas)">
    <canvas id="bdCanvas"></canvas><canvas id="bdLive"></canvas>
  </main>
  <input id="imgIn" type="file" accept="image/*" hidden>
  <input id="camIn" type="file" accept="image/*" capture="environment" hidden>
  <div id="pageBadge" class="page-badge num" hidden></div>
  <button id="markBtn" type="button" class="mark-btn" hidden title="Star this page" aria-label="Star page" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg></button>
  <button id="fsBtn" type="button" class="fs-btn" hidden aria-pressed="false" aria-label="Full screen" title="Full screen: hide toolbars">
    <svg class="fs-in" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
    <svg class="fs-out" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
  </button>

  <div id="presentPanel" class="present-panel" hidden>
    <div id="presentFavs" class="present-favs" hidden></div>
    <div class="pp-row">
      <button id="ppPrev" type="button" class="icon-btn" aria-label="Previous page"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span id="ppPage" class="num pp-page"></span>
      <button id="ppNext" type="button" class="icon-btn" aria-label="Next page"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>
      <button id="ppPen" type="button" class="icon-btn" aria-label="Show pens" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg></button>
      <button id="ppLaser" type="button" class="icon-btn" aria-pressed="false" aria-label="Laser pointer" title="Laser pointer: point and circle, fades after 2 seconds"><svg viewBox="0 0 24 24" class="laser-ic"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></button>
      <button id="ppLive" type="button" class="icon-btn srv-only" aria-pressed="false" aria-label="Live view" title="Live view: QR code for students"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/></svg></button>
      <button id="ppLiveBadge" type="button" class="live-badge srv-only" hidden><i></i><span>LIVE</span></button>
      <button id="ppMirror" type="button" class="icon-btn" aria-pressed="false" aria-label="Mirror" title="Mirror (teleprompter on the same screen)"><svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7L3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/></svg></button>
      <button id="ppUndo" type="button" class="icon-btn" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
      <button id="ppExit" type="button" class="icon-btn" aria-label="End presentation"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
  </div>
</div>

<dialog id="uploadDlg" class="dlg">
  <form method="dialog" id="uploadForm">
    <h2 id="upTitle">Upload PDFs</h2>
    <label for="upFolder">Folder</label>
    <input id="upFolder" list="folderList" placeholder="e.g. Micro or Accounting/2026" autocomplete="off">
    <datalist id="folderList"></datalist>
    <label for="upFiles">files</label>
    <input id="upFiles" type="file" accept="application/pdf,.pdf" multiple required>
    <p id="upHint" class="muted small"></p>
    <label class="check" id="upImgRow" hidden><input id="upImgOne" type="checkbox" checked> <span>Combine photos/images into <b>one</b> PDF (otherwise each image becomes its own PDF)</span></label>
    <p id="upMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="cancel" type="submit" class="btn" formnovalidate>Cancel</button>
      <button id="upGo" value="ok" type="button" class="btn primary">Upload</button>
    </div>
  </form>
</dialog>

<dialog id="ncDlg" class="dlg">
  <form method="dialog" id="ncForm">
    <h2>Connect Nextcloud</h2>
    <p class="muted">PDFs you put in the chosen Nextcloud folder appear automatically in PDF-Stift – even from your PC. Subfolders become courses.</p>
    <label for="ncUrl">Your Nextcloud address</label>
    <input id="ncUrl" type="url" placeholder="https://cloud.example.org" autocomplete="off">
    <label for="ncUser">Username</label>
    <input id="ncUser" autocomplete="off" autocapitalize="off">
    <label for="ncPass">App password</label>
    <input id="ncPass" type="password" autocomplete="off" placeholder="in Nextcloud: Settings → Security → Create app password">
    <label for="ncFolder">Folder in Nextcloud</label>
    <input id="ncFolder" value="PDF-Stift" autocomplete="off">
    <label class="check" hidden><input id="ncExport" type="checkbox"> Automatically save annotated PDFs to Nextcloud (subfolder “Mit Notizen”)</label>
    <p id="ncMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="ncRemove" type="button" class="btn" hidden>Disconnect</button>
      <button value="cancel" type="submit" class="btn" formnovalidate>Close</button>
      <button id="ncSave" type="button" class="btn primary">Save &amp; sync</button>
    </div>
  </form>
</dialog>

<dialog id="odDlg" class="dlg wide">
  <form method="dialog">
    <h2>Connect OneDrive</h2>
    <p class="muted">You sign in directly with Microsoft – PDF-Stift never sees your password. You need your own “app registration” once (free, about 5 minutes, instructions in the README):</p>
    <ol class="steps">
      <li><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">entra.microsoft.com</a> → App registrations → <b>New registration</b>, name “PDF-Stift”, account types: <b>Any organizational directory and personal Microsoft accounts</b>.</li>
      <li>Authentication → Advanced settings → <b>Allow public client flows: Yes</b> → Save.</li>
      <li>API permissions → Microsoft Graph → Delegated: <b>Files.ReadWrite</b>, <b>Notes.Read</b> (for OneNote), <b>offline_access</b>, <b>User.Read</b>.</li>
      <li>Under “Overview”, copy the <b>Application (client) ID</b> and paste it here.</li>
    </ol>
    <label for="odClient">Application (client) ID</label>
    <input id="odClient" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="1a2b3c4d-1234-5678-9abc-def012345678">
    <label for="odFolder">Folder in OneDrive (empty = all of OneDrive)</label>
    <input id="odFolder" autocomplete="off" placeholder="e.g. Teaching">
    <label for="odTenant">Only for university/work accounts, if needed: Directory (tenant) ID</label>
    <input id="odTenant" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="leave empty = common">
    <div id="odCode" class="od-code" hidden>
      <p>Open <a id="odLink" href="https://microsoft.com/devicelogin" target="_blank" rel="noopener">microsoft.com/devicelogin</a> (works on your phone too) and enter this code:</p>
      <div class="copyrow"><code id="odUserCode" class="user-code"></code><button id="odCopy" type="button" class="btn">Copy</button></div>
    </div>
    <p id="odMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="odRemove" type="button" class="btn" hidden>Sign out</button>
      <button value="cancel" type="submit" class="btn" formnovalidate>Close</button>
      <button id="odLogin" type="button" class="btn primary">Sign in with Microsoft</button>
    </div>
  </form>
</dialog>

<dialog id="scDlg" class="dlg wide">
  <form method="dialog">
    <h2>iPad: “Share → Send to PDF-Stift”</h2>
    <p class="muted">With a shortcut you can send PDFs from any app – including iCloud Drive in the Files app – straight to the “Eingang” folder. Set it up once:</p>
    <ol class="steps">
      <li>Open the <b>Shortcuts</b> app → <b>+</b> → at the top, change the name to “Send to PDF-Stift”.</li>
      <li>Using the ⓘ icon, turn <b>“Show in Share Sheet”</b> on; allow only <b>PDFs</b> or <b>files</b> as input.</li>
      <li>Add the action <b>“Repeat with Each”</b> and choose <i>Shortcut Input</i> as its input.</li>
      <li>Inside it, add the action <b>“Get Contents of URL”</b> with the URL: <code id="scUrl"></code></li>
      <li>Expand it there: Method <b>POST</b>; under <b>Headers</b> add an entry <code>X-PDFStift-Token</code> with the key below; Request Body <b>Form</b>, field <code>files[]</code> of type <b>file</b> = <i>Repeat Item</i>, field <code>folder</code> (Text) = <code>Eingang</code>.</li>
      <li>Done. In any app: Share → “Send to PDF-Stift”.</li>
    </ol>
    <label for="scToken">Your key</label>
    <div class="copyrow"><input id="scToken" readonly><button type="button" class="btn" data-copy="scToken">Copy</button></div>
    <p class="muted">The key only allows uploading. If it falls into the wrong hands: generate a new one – the old one will then stop working.</p>
    <div class="dlg-actions">
      <button id="scRenew" type="button" class="btn">Generate new key</button>
      <button value="ok" class="btn primary">Done</button>
    </div>
  </form>
</dialog>

<dialog id="bkDlg" class="dlg">
  <form method="dialog">
    <h2>Device, storage &amp; backup</h2>
    <h3 class="dlg-sub">On this device</h3>
    <p id="devInfo" class="muted">…</p>
    <p class="muted small">Each PDF is downloaded once when you first open it and then stays on the device. If it changes on the server (another tablet, nightly shrinking), the app fetches the new version in the background. Notes are synced immediately anyway.</p>
    <label class="check"><input type="radio" name="devMode" value="need"> <span><b>Download when needed and keep</b> (recommended)</span></label>
    <label class="check"><input type="radio" name="devMode" value="all"> <span><b>Keep all PDFs on the device</b> – gradually downloads everything over Wi-Fi; new PDFs are added automatically</span></label>
    <p id="devApp" class="small"></p>
    <p id="devWinApp" class="small" hidden></p>
    <p id="devWin" hidden><a class="btn primary" href="android/win/PDF-Stift-Setup.exe" download="PDF-Stift-Setup.exe">Download and install the Windows app</a></p>
    <p id="devApk" hidden><a class="btn primary" href="android/pdfstift.apk" download="PDF-Stift.apk">Download and install the Android app</a></p>
    <div class="dlg-actions">
      <button id="devInstall" type="button" class="btn primary" hidden>Install as app</button>
      <button id="devPersist" type="button" class="btn" hidden>Make storage persistent</button>
      <button id="devClear" type="button" class="btn">Remove all copies from the device …</button>
    </div>
    <h3 class="dlg-sub">Backup to Nextcloud</h3>
    <p class="muted small">Every night, everything that exists only here on the server is copied to the Nextcloud folder <b>PDF-Stift-Sicherung</b>: your own uploaded PDFs, all notes, notebooks, images, signature. Only new and changed items are transferred; deleted items are kept in the backup.</p>
    <label class="check"><input id="nbAuto" type="checkbox"> <span>Back up to Nextcloud every night</span></label>
    <p id="nbInfo" class="muted"></p>
    <div class="dlg-actions"><button id="nbCheck" type="button" class="btn">Check backup</button><button id="nbRestore" type="button" class="btn">Restore …</button><button id="nbNow" type="button" class="btn">Back up now</button></div>
    <p id="nbCheckInfo" class="small" hidden></p>
    <h3 class="dlg-sub">Secure sign-in</h3>
    <p class="muted small">After 5 wrong passwords, PDF-Stift blocks further attempts from this internet address for 5 minutes, then longer each time (up to 1 hour). With the <b>second factor</b> every new sign-in also requires a 6-digit code from an authenticator app (e.g. Google Authenticator, Microsoft Authenticator, 2FAS). Devices already signed in stay signed in.</p>
    <p id="afInfo" class="muted"></p>
    <div id="afSetup" hidden>
      <p class="small">1. In the authenticator app, choose “Add account” → scan the QR code (or type in the key):</p>
      <div id="afQr" class="af-qr"></div>
      <p class="small">Key: <code id="afSecret"></code></p>
      <p class="small">2. Enter the 6-digit code the app now shows here:</p>
      <div class="af-row"><input id="afCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"><button id="afConfirm" type="button" class="btn primary">Turn on</button></div>
    </div>
    <div id="afCodes" hidden>
      <p class="small"><b>Recovery codes – write them down or print them now!</b> Each one works once instead of the app code, in case you lose your phone. They are shown only this once.</p>
      <pre id="afList" class="af-list"></pre>
      <div class="dlg-actions"><button id="afCopy" type="button" class="btn">Copy</button></div>
    </div>
    <div class="dlg-actions"><button id="afOn" type="button" class="btn" hidden>Set up second factor …</button><button id="afOff" type="button" class="btn" hidden>Turn off second factor …</button></div>
    <h3 class="dlg-sub">Back up notes</h3>
    <p class="muted">Downloads all notes from all PDFs as one file. When restored, they are added to the existing ones – nothing gets lost.</p>
    <div class="dlg-actions col">
      <button id="bkDown" type="button" class="btn primary">Back up notes (download)</button>
      <label class="btn" for="bkFile">Restore backup …</label>
      <input id="bkFile" type="file" accept="application/json,.json" hidden>
    </div>
    <p id="bkMsg" class="muted"></p>
    <h3 class="dlg-sub">Nightly cron job</h3>
    <p class="muted small">Every night the server syncs with Nextcloud, shrinks large PDFs and builds the search index for full-text search.</p>
    <p class="muted small"><b>Shrinking:</b> all PDFs from 10 MB. Pages, text, notes and images stay exactly the same – images are never downsampled, so even small photos stay sharp when zoomed in a lot. A file is only replaced if it becomes clearly smaller and looks the same; the original is kept for 7 days in <code>storage/backup/verkleinert</code>.</p>
    <label class="check"><input id="shAuto" type="checkbox"> Shrink large PDFs</label>
    <label class="check" id="shNcRow" hidden><input id="shNc" type="checkbox"> Also replace the originals in Nextcloud with the smaller version (Nextcloud keeps the old version under “Versions”)</label>
    <p id="shInfo" class="muted"></p>
    <label for="shCli">Cron job at your host (daily at 3 am), command line:</label>
    <div class="copyrow"><input id="shCli" readonly><button type="button" class="btn" data-copy="shCli">Copy</button></div>
    <label for="shUrl">… or, if your host can only call URLs:</label>
    <div class="copyrow"><input id="shUrl" readonly><button type="button" class="btn" data-copy="shUrl">Copy</button></div>
    <div class="dlg-actions">
      <button id="shNow" type="button" class="btn">Shrink now</button>
      <button id="shUndo" type="button" class="btn">Undo shrinking …</button>
      <button value="ok" class="btn">Close</button>
    </div>
  </form>
</dialog>


<dialog id="pickDlg" class="dlg">
  <form method="dialog">
    <h2 id="pickTitle">Combine PDFs</h2>
    <p id="pickText" class="muted">Tap the PDFs in the order you want.</p>
    <input id="pickSearch" type="search" placeholder="Search …" autocomplete="off">
    <div id="pickList" class="pick-list"></div>
    <label class="btn pick-dev" for="pickFiles">Add from this device (PDF, Word, Excel, PowerPoint, images) …</label>
    <input id="pickFiles" type="file" multiple hidden accept="application/pdf,.pdf,image/*,.doc,.docx,.odt,.rtf,.ppt,.pptx,.odp,.xls,.xlsx,.ods">
    <h3 class="dlg-sub">Dropdown</h3>
    <ol id="pickSel" class="pick-sel"></ol>
    <div id="pickNameRow"><label for="pickName">Name of the new PDF</label><input id="pickName" autocomplete="off"></div>
    <p id="pickMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Cancel</button>
      <button id="pickGo" value="yes" class="btn primary">Combine</button>
    </div>
  </form>
</dialog>

<dialog id="stampDlg" class="dlg">
  <form method="dialog">
    <h2>Header/footer, page numbers, watermark</h2>
    <p class="muted small">Placeholders: <code>{n}</code> page, <code>{N}</code> total pages, <code>{datum}</code>, <code>{datei}</code>. Written permanently into the PDF (the previous version stays backed up on the server).</p>
    <label for="stHead">Header (top center)</label><input id="stHead" autocomplete="off">
    <label for="stFoot">Footer (bottom left)</label><input id="stFoot" autocomplete="off">
    <label for="stNum">Page numbers</label>
    <select id="stNum"><option value="">none</option><option value="{n}">1</option><option value="Page {n} of {N}" selected>Page 1 of 9</option><option value="{n} / {N}">1 / 9</option></select>
    <label for="stNumPos">Page number position</label>
    <select id="stNumPos"><option value="br">bottom right</option><option value="bc">bottom center</option><option value="tr">top right</option></select>
    <label for="stWm">Watermark (diagonal across the page)</label><input id="stWm" placeholder="e.g. DRAFT" autocomplete="off">
    <div class="row2">
      <div><label for="stSize">Font size</label><input id="stSize" type="number" min="6" max="24" value="9"></div>
      <div><label for="stFrom">from page</label><input id="stFrom" type="number" min="1" value="1"></div>
    </div>
    <p id="stMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Cancel</button>
      <button id="stGo" value="yes" class="btn primary">Insert</button>
    </div>
  </form>
</dialog>

<dialog id="olDlg" class="dlg">
  <form method="dialog">
    <h2>Bookmarks</h2>
    <p class="muted small">Tap to jump to the page. Changes are written into the PDF – other PDF programs will show the bookmarks too.</p>
    <div id="olList" class="ol-list"></div>
    <p id="olMsg" class="muted"></p>
    <div class="dlg-actions">
      <button id="olAdd" type="button" class="btn">Bookmark for this page …</button>
      <button id="olSave" type="button" class="btn primary" hidden>Save changes</button>
      <button value="ok" class="btn">Close</button>
    </div>
  </form>
</dialog>

<dialog id="convDlg" class="dlg">
  <form method="dialog">
    <h2>Convert</h2>
    <p class="muted small">Notes are included. Everything happens on this device.</p>
    <div class="dlg-actions col">
      <button id="cvDocx" type="button" class="btn primary">Word file (.docx) – text for further editing</button>
      <button id="cvDocxImg" type="button" class="btn">Word file (.docx) – pages as images, looks like the PDF</button>
      <button id="cvXlsx" type="button" class="btn">Excel file (.xlsx) – tables and numbers, one sheet per page</button>
      <button id="cvPptx" type="button" class="btn">PowerPoint (.pptx) – one slide per page</button>
      <button id="cvJpg" type="button" class="btn">All pages as images (JPG, as ZIP)</button>
      <button id="cvPng" type="button" class="btn">This page as image (PNG)</button>
      <button id="cvTxt" type="button" class="btn">Text only (.txt)</button>
    </div>
    <p id="cvMsg" class="muted"></p>
    <div class="dlg-actions"><button value="ok" class="btn">Close</button></div>
  </form>
</dialog>


<dialog id="sigDlg" class="dlg">
  <form method="dialog">
    <h2>Your signature</h2>
    <p class="muted small">Sign once with pen or finger – it is saved and then available on all devices.</p>
    <canvas id="sigPad" class="sig-pad" width="900" height="300"></canvas>
    <div class="dlg-actions">
      <button id="sigClear" type="button" class="btn">Clear</button>
      <button id="sigReset" type="button" class="btn" title="Delete saved signature">Delete saved</button>
      <button value="no" class="btn">Cancel</button>
      <button id="sigSave" value="yes" class="btn primary">Save and insert</button>
    </div>
  </form>
</dialog>

<dialog id="stDlg" class="dlg">
  <form method="dialog">
    <h2>Stamp</h2>
    <div class="st-opts">
      <div id="stColors" class="st-colors" aria-label="Color">
        <button type="button" data-c="auto" title="Stamp color">Auto</button>
        <button type="button" data-c="#C81E1E" style="--c:#C81E1E" aria-label="Red"></button>
        <button type="button" data-c="#1F8A4C" style="--c:#1F8A4C" aria-label="Green"></button>
        <button type="button" data-c="#1E4FB8" style="--c:#1E4FB8" aria-label="Blue"></button>
        <button type="button" data-c="#C2410C" style="--c:#C2410C" aria-label="Orange"></button>
        <button type="button" data-c="#7E3AC7" style="--c:#7E3AC7" aria-label="Purple"></button>
        <button type="button" data-c="#1B1F29" style="--c:#1B1F29" aria-label="Black"></button>
      </div>
      <div class="row2">
        <div><label for="stName">Name / initials (optional)</label><input id="stName" autocomplete="off" placeholder="e.g. Dr. Smith"></div>
        <div><label for="stNote">Remark (optional)</label><input id="stNote" autocomplete="off" placeholder="e.g. Ref. 2026/114"></div>
      </div>
      <label class="check"><input id="stWhen" type="checkbox"> <span>Add date and time</span></label>
    </div>
    <div id="stList" class="stamp-list"></div>
    <label for="stOwn">Custom stamp</label>
    <div class="copyrow"><input id="stOwn" placeholder="e.g. Paid on {datum}" autocomplete="off"><button id="stOwnGo" type="button" class="btn">Insert</button></div>
    <div class="dlg-actions"><button value="no" class="btn">Close</button></div>
  </form>
</dialog>

<dialog id="fbDlg" class="dlg">
  <form method="dialog">
    <h2>New form field</h2>
    <label for="fbType">Type</label>
    <select id="fbType"><option value="text">Text box (single line)</option><option value="multi">Text box (multiple lines)</option><option value="check">Checkbox</option><option value="choice">Dropdown list</option></select>
    <label for="fbName">Field name</label><input id="fbName" autocomplete="off">
    <div id="fbOptRow"><label for="fbOpts">Options (comma-separated)</label><input id="fbOpts" autocomplete="off" placeholder="e.g. yes, no, maybe"></div>
    <div class="dlg-actions">
      <button value="no" class="btn">Discard</button>
      <button value="yes" class="btn primary">Create field</button>
    </div>
  </form>
</dialog>

<dialog id="cmpDlg" class="dlg">
  <form method="dialog">
    <h2>Compare</h2>
    <p class="muted small">What should the open PDF be compared with?</p>
    <div id="cmpVers" class="pick-list"></div>
    <div class="dlg-actions">
      <button id="cmpOther" type="button" class="btn">Choose another PDF …</button>
      <button value="no" class="btn">Cancel</button>
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
      <button value="no" class="btn">Cancel</button>
      <button value="yes" class="btn primary" id="askYes">OK</button>
    </div>
  </form>
</dialog>

<dialog id="confirmDlg" class="dlg">
  <form method="dialog">
    <h2 id="confirmTitle">Are you sure?</h2>
    <p id="confirmText" class="muted"></p>
    <div class="dlg-actions">
      <button value="no" class="btn">Cancel</button>
      <button value="yes" class="btn danger" id="confirmYes">Delete</button>
    </div>
  </form>
</dialog>

<dialog id="onDlg" class="dlg">
  <form method="dialog">
    <h2>Import from OneNote</h2>
    <p class="muted">Each OneNote page becomes a note page with text, images, tables and your handwriting – everything stays editable. Notebooks and sections keep their order. Pages already imported are skipped.</p>
    <div id="onList" class="on-list"></div>
    <label class="check"><input id="onUpd" type="checkbox"> Also re-import pages that have changed in OneNote since then (replaces your changes to those pages in PDF-Stift)</label>
    <p id="onMsg" class="muted"></p>
    <div class="dlg-actions">
      <button value="cancel" class="btn">Cancel</button>
      <button id="onGo" type="button" class="btn primary">Apply</button>
    </div>
  </form>
</dialog>

<div id="importBar" class="ocr-bar" hidden role="status"><span class="spin" aria-hidden="true"></span><span id="importText"></span><button id="importStop" type="button" class="text-btn">Pause</button></div>

<div id="tbDrop" class="tb-drop" hidden></div>
<div id="peBar" class="pe-bar" hidden>
  <span id="peText"></span>
  <span id="peExtra" class="pe-extra"></span>
  <button id="peApply" type="button" class="btn primary" hidden>Apply redaction</button>
  <button id="peDone" type="button" class="btn">Done</button>
</div>


<div id="livePanel" class="live-panel" hidden role="dialog" aria-label="Live view">
  <div class="lv-qr" id="lvQr"></div>
  <div class="lv-side">
    <div class="lv-live"><i></i>LIVE VIEW</div>
    <p class="lv-big">Point your phone camera at the QR code</p>
    <p class="lv-url"><span id="lvUrl"></span></p>
    <p class="muted">or go to <b>live.php</b> and enter the code: <b id="lvCode" class="lv-code"></b></p>
    <p id="lvCount" class="muted"></p>
    <p class="muted small">Students see only the page currently shown, with your notes – no sign-in, no download.</p>
    <div class="dlg-actions">
      <button id="lvCopy" type="button" class="btn">Copy link</button>
      <button id="lvStop" type="button" class="btn danger">Exit</button>
      <button id="lvHide" type="button" class="btn primary">Hide QR code</button>
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
<script src="app/l10n.en.js?v=<?= $v ?>"></script>
<script defer src="app/app.en.js?v=<?= $v ?>"></script>
</body>
</html>
