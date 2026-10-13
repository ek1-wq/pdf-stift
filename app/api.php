<?php
declare(strict_types=1);
require __DIR__ . '/lib/common.php';
require __DIR__ . '/lib/nextcloud.php';
require __DIR__ . '/lib/onedrive.php';
require __DIR__ . '/lib/convert.php';
require __DIR__ . '/lib/decks.php';
if (is_file(__DIR__ . '/lib/live.php')) { require __DIR__ . '/lib/live.php'; }
require __DIR__ . '/lib/shrink.php';
require __DIR__ . '/lib/search.php';
require __DIR__ . '/lib/boards.php';
if (is_file(__DIR__ . '/lib/onenote.php')) { require __DIR__ . '/lib/onenote.php'; }
if (is_file(__DIR__ . '/lib/ncbackup.php')) { require __DIR__ . '/lib/ncbackup.php'; }
if (is_file(__DIR__ . '/lib/selfupdate.php')) { require __DIR__ . '/lib/selfupdate.php'; }
require __DIR__ . '/lib/meta.php';
require __DIR__ . '/lib/auth2.php';
require __DIR__ . '/lib/demo.php';

$a = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Persönlicher Zugangsschlüssel für den iPad-Kurzbefehl (nur zum Hochladen)
$token = (string) ($_SERVER['HTTP_X_PDFSTIFT_TOKEN'] ?? '');
$tokenOk = $token !== '' && api_token() !== '' && hash_equals(api_token(), $token);

// „Teilen → PDF-Stift“ (Android) kommt als normales Formular ohne eigenen Header
if ($method === 'POST' && $a !== 'share' && !$tokenOk && ($_SERVER['HTTP_X_PDFSTIFT'] ?? '') !== '1') {
    fail('Ungültige Anfrage.', 403);
}

function body(): array
{
    $data = json_decode((string) file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

// ---------- ohne Anmeldung ----------
if ($a === 'me') {
    json_out(['setup' => needs_setup(), 'loggedIn' => !needs_setup() && is_logged_in(), 'version' => PDFSTIFT_VERSION, 'edition' => edition(), 'demo' => demo_public()]);
}
// Demo: stündlich zurücksetzen (Cronjob ruft diese Adresse mit dem geheimen Schlüssel auf)
if ($a === 'demoreset') {
    json_out(demo_reset((string) ($_GET['key'] ?? '')));
}

if ($a === 'setup' && $method === 'POST') {
    if (!needs_setup()) {
        fail('Die App ist bereits eingerichtet.', 403);
    }
    $pw = (string) (body()['password'] ?? '');
    if (mb_strlen($pw) < 8) {
        fail('Das Passwort braucht mindestens 8 Zeichen.');
    }
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $php = "<?php\n// Von PDF-Stift beim Einrichten erzeugt.\nreturn [\n    'password_hash' => " . var_export($hash, true) . ",\n    'session_days'  => 60,\n];\n";
    if (@file_put_contents(dirname(__FILE__) . '/config.php', $php) === false) {
        fail('config.php konnte nicht geschrieben werden. Bitte Schreibrechte für den App-Ordner prüfen.', 500);
    }
    storage('pdfs');
    storage('notes');
    start_session();
    session_regenerate_id(true);
    $_SESSION['ok'] = true;
    json_out(['ok' => true]);
}

if ($a === 'login' && $method === 'POST') {
    if (needs_setup()) {
        fail('Bitte zuerst einrichten.', 409);
    }
    if (($wait = auth_locked()) > 0) {
        fail('Zu viele Fehlversuche. Bitte in ' . max(1, (int) ceil($wait / 60)) . ' Minuten erneut versuchen.', 429);
    }
    $b = body();
    $pw = (string) ($b['password'] ?? '');
    if (!password_verify($pw, cfg()['password_hash'])) {
        auth_fail();
        sleep(2);
        fail('Das Passwort stimmt nicht.', 401);
    }
    if (auth_2fa_on()) {
        $code = trim((string) ($b['code'] ?? ''));
        if ($code === '') {
            json_out(['need2fa' => true]);
        }
        if (!auth_second_ok($code)) {
            auth_fail();
            sleep(1);
            fail('Der Code stimmt nicht. Bitte den aktuellen Code aus der Authenticator-App eingeben.', 401);
        }
    }
    auth_ok();
    start_session();
    session_regenerate_id(true);
    $_SESSION['ok'] = true;
    json_out(['ok' => true]);
}

if ($a === 'logout' && $method === 'POST') {
    start_session();
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

// ---------- Lieferwege für Apps und Server-Updates (nur in der eigenen Ausgabe, Schlüssel im privaten GitHub-Projekt)
if (!is_local() && is_file(__DIR__ . '/lib/admin.php')) {
    require __DIR__ . '/lib/admin.php';
}

// ---------- Live-Mitschau: öffentlich, nur mit gültigem Sitzungscode ----------
if ($a === 'livestate' && function_exists('live_read')) {
    $code = strtoupper((string) ($_GET['c'] ?? ''));
    $s = live_read($code);
    if (!$s) {
        json_out(['ended' => true]);
    }
    live_seen($code, (string) ($_GET['v'] ?? ''));
    header('Cache-Control: no-store');
    if ((int) ($_GET['rev'] ?? 0) === (int) $s['rev']) {
        json_out(['rev' => $s['rev'], 'same' => true]);
    }
    $file = storage('pdfs') . '/' . $s['path'];
    $out = [
        'rev' => $s['rev'], 'srev' => $s['srev'] ?? 0, 'title' => preg_replace('/\.pdf$/i', '', basename($s['path'])),
        'pdfv' => is_file($file) ? substr(md5($s['path']), 0, 8) . '-' . filemtime($file) . '-' . filesize($file) : '',
        'page' => $s['page'], 'cur' => $s['cur'] ?? null, 'laser' => $s['laser'], 'lt' => $s['lt'] ?? 0, 'now' => (int) round(microtime(true) * 1000),
    ];
    // Notizen der Seite nur schicken, wenn sie sich geändert haben
    if ((int) ($_GET['srev'] ?? -1) !== (int) ($s['srev'] ?? 0)) {
        $out['strokes'] = $s['strokes'];
    }
    json_out($out);
}
if ($a === 'livepdf' && function_exists('live_read')) {
    $s = live_read(strtoupper((string) ($_GET['c'] ?? '')));
    $file = $s ? storage('pdfs') . '/' . $s['path'] : '';
    if (!$s || !is_file($file)) {
        fail('Diese Live-Sitzung ist beendet.', 404);
    }
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($file));
    header('Cache-Control: private, max-age=600');
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    exit;
}

// ---------- ab hier nur angemeldet ----------
if (needs_setup() || (!($tokenOk && $a === 'upload') && !is_logged_in())) {
    if ($a === 'share') {
        header('Location: ./', true, 303);
        exit;
    }
    fail('Bitte anmelden.', 401);
}
demo_guard($a);

// ---------- freie Ausgabe: Dienste, die einen echten Server brauchen, gibt es nicht ----------
if (is_local() && preg_match('/^(nc|od|on[a-z]|live|totp_|srvupdate|token$|share$|appreport$|setup$|login$)/', $a)) {
    fail('In dieser Ausgabe nicht verfügbar.', 404);
}

// ---------- Anmeldung absichern (zweiter Faktor) ----------
if ($a === 'auth_status') {
    $au = auth_read();
    json_out(['on' => $au['totp'] !== '', 'recoveryLeft' => count($au['recovery'])]);
}
if ($a === 'totp_setup' && $method === 'POST') {
    $au = auth_read();
    if ($au['totp'] !== '') {
        fail('Der zweite Faktor ist bereits eingeschaltet.', 409);
    }
    $au['pending'] = b32_encode(random_bytes(20));
    auth_write($au);
    $label = rawurlencode('PDF-Stift:' . ($_SERVER['HTTP_HOST'] ?? 'pad'));
    json_out(['secret' => $au['pending'], 'url' => 'otpauth://totp/' . $label . '?secret=' . $au['pending'] . '&issuer=PDF-Stift&digits=6&period=30']);
}
if ($a === 'totp_enable' && $method === 'POST') {
    $au = auth_read();
    if ($au['pending'] === '' || !totp_check($au['pending'], (string) (body()['code'] ?? ''))) {
        fail('Der Code passt nicht. Bitte den gerade angezeigten 6-stelligen Code aus der App eingeben.');
    }
    $plain = [];
    $al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($k = 0; $k < 8; $k++) {
        $c = '';
        for ($m = 0; $m < 10; $m++) {
            $c .= $al[random_int(0, strlen($al) - 1)];
        }
        $plain[] = substr($c, 0, 5) . '-' . substr($c, 5);
    }
    $au['totp'] = $au['pending'];
    $au['pending'] = '';
    $au['recovery'] = array_map(fn ($c) => password_hash(str_replace('-', '', $c), PASSWORD_DEFAULT), $plain);
    auth_write($au);
    json_out(['ok' => true, 'recovery' => $plain]);
}
if ($a === 'totp_disable' && $method === 'POST') {
    if (!auth_second_ok((string) (body()['code'] ?? ''))) {
        fail('Der Code stimmt nicht.');
    }
    $au = auth_read();
    $au['totp'] = '';
    $au['pending'] = '';
    $au['recovery'] = [];
    auth_write($au);
    json_out(['ok' => true]);
}

/** Speichert hochgeladene PDFs in einen Ordner und gibt die neuen Pfade zurück. */
function save_uploads(string $folder, ?array $files, ?string $wanted = null): array
{
    $dir = storage('pdfs') . ($folder !== '' ? '/' . $folder : '');
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        fail('Ordner konnte nicht angelegt werden.', 500);
    }
    $saved = [];
    if (!$files || !is_array($files['name'])) {
        return $saved;
    }
    foreach ($files['name'] as $i => $orig) {
        if ($files['error'][$i] !== UPLOAD_ERR_OK) {
            continue;
        }
        $tmp = $files['tmp_name'][$i];
        $ext = strtolower((string) pathinfo((string) $orig, PATHINFO_EXTENSION));
        if ((string) file_get_contents($tmp, false, null, 0, 5) !== '%PDF-') {
            if (!in_array($ext, OFFICE_EXT, true)) {
                $GLOBALS['upload_errors'][] = basename((string) $orig) . ': keine PDF';
                continue;
            }
            // Word/PowerPoint → PDF
            $conv = storage('tmp') . '/' . bin2hex(random_bytes(8)) . '.pdf';
            @set_time_limit(300);
            $err = office_to_pdf($tmp, $ext, $conv);
            if ($err !== '') {
                $GLOBALS['upload_errors'][] = basename((string) $orig) . ': ' . $err;
                continue;
            }
            $tmp = $conv;
            $orig = preg_replace('/\.[^.]+$/', '', basename((string) $orig)) . '.pdf';
            $wanted = ($wanted !== null && $wanted !== '') ? preg_replace('/\.[^.]+$/', '', $wanted) . '.pdf' : $wanted;
        }
        // Gewünschter Name (z. B. vom OneNote-Export) hat Vorrang, wenn genau eine Datei kommt
        $src = ($wanted !== null && $wanted !== '' && count($files['name']) === 1) ? $wanted : (string) $orig;
        $name = ltrim(preg_replace('/[\/\\\\\x00-\x1F]/', '_', basename($src)), '.');
        if (!preg_match('/\.pdf$/i', $name)) {
            $name .= '.pdf';
        }
        $target = "$dir/$name";
        $n = 2;
        while (file_exists($target)) {
            $target = $dir . '/' . preg_replace('/\.pdf$/i', '', $name) . " ($n).pdf";
            $n++;
        }
        if (is_uploaded_file($tmp) ? move_uploaded_file($tmp, $target) : rename($tmp, $target)) {
            $saved[] = ltrim(($folder !== '' ? $folder . '/' : '') . basename($target), '/');
        }
    }
    return $saved;
}
session_write_close(); // parallele Anfragen nicht blockieren

switch ($a) {
    case 'list':
        $lib = list_pdfs();
        json_out($lib + ['nc' => nc_public(nc_cfg()), 'od' => od_public(od_cfg()), 'caps' => convert_caps(), 'shrink' => shrink_public($lib['files'])]);

    case 'thumb':
        if ($method === 'POST') {
            $b = body();
            $rel = safe_rel((string) ($b['path'] ?? ''));
            $file = doc_abs($rel);
            if (!is_file($file)) {
                fail('Datei nicht gefunden.', 404);
            }
            $data = (string) ($b['data'] ?? '');
            $bin = base64_decode(preg_replace('#^data:image/jpeg;base64,#', '', $data), true);
            if ($bin === false || strlen($bin) > 400000 || substr($bin, 0, 2) !== "\xFF\xD8") {
                fail('Ungültiges Vorschaubild.');
            }
            foreach (glob(storage('thumbs') . '/' . sha1($rel) . '-*.jpg') ?: [] as $old) {
                @unlink($old);
            }
            file_put_contents(thumb_file($rel, filemtime($file)), $bin);
            json_out(['ok' => true]);
        }
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $file = doc_abs($rel);
        $tf = is_file($file) ? thumb_file($rel, filemtime($file)) : '';
        if (!$tf || !is_file($tf)) {
            fail('Kein Vorschaubild.', 404);
        }
        header('Content-Type: image/jpeg');
        header('Cache-Control: private, max-age=31536000, immutable');
        header('Content-Length: ' . filesize($tf));
        readfile($tf);
        exit;

    case 'mkdir':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        $dir = storage('pdfs') . '/' . $rel;
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
            fail('Ordner konnte nicht angelegt werden.', 500);
        }
        json_out(['ok' => true, 'path' => $rel]);

    case 'move':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $from = safe_rel((string) ($b['from'] ?? ''));
        $to = safe_rel((string) ($b['to'] ?? ''));
        if (!preg_match('/\.pdf$/i', $to)) {
            $to .= '.pdf';
        }
        $src = pdf_abs($from);
        $dst = pdf_abs($to);
        if (!is_file($src)) {
            fail('Datei nicht gefunden.', 404);
        }
        if (file_exists($dst)) {
            fail('Dort gibt es schon eine Datei mit diesem Namen.', 409);
        }
        $nc = nc_cfg();
        if (isset($nc['etags'][$from])) {
            fail('Diese PDF kommt aus Nextcloud. Bitte verschiebe sie in Nextcloud – PDF-Stift übernimmt das dann.', 409);
        }
        if (!is_dir(dirname($dst)) && !@mkdir(dirname($dst), 0775, true)) {
            fail('Ordner konnte nicht angelegt werden.', 500);
        }
        $mtime = filemtime($src);
        if (!@rename($src, $dst)) {
            fail('Verschieben fehlgeschlagen.', 500);
        }
        @touch($dst, $mtime);
        // Notizen und Vorschaubild mitnehmen
        if (is_file(notes_file($from))) {
            $doc = json_decode((string) file_get_contents(notes_file($from)), true) ?: [];
            $doc['path'] = $to;
            file_put_contents(notes_file($to), json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
            @unlink(notes_file($from));
        }
        foreach (glob(storage('thumbs') . '/' . sha1($from) . '-*.jpg') ?: [] as $t) {
            @rename($t, thumb_file($to, $mtime));
        }
        meta_move($from, $to);
        if (is_file(audio_index_file())) {
            audio_index_update(function (array $ix) use ($from, $to) {
                if (isset($ix[$from])) {
                    $ix[$to] = array_merge($ix[$to] ?? [], $ix[$from]);
                    unset($ix[$from]);
                }
                return $ix;
            });
        }
        clearstatcache();
        json_out(['ok' => true, 'path' => $to, 'mtime' => filemtime($dst), 'size' => filesize($dst)]);

    case 'token':
        if ($method === 'POST' || api_token() === '') {
            file_put_contents(storage() . '/token.txt', bin2hex(random_bytes(20)), LOCK_EX);
        }
        json_out(['token' => api_token()]);

    case 'backup':
        $docs = [];
        foreach (glob(storage('notes') . '/*.json') ?: [] as $f) {
            $d = json_decode((string) file_get_contents($f), true);
            if (is_array($d) && !empty($d['path']) && !empty($d['strokes'])) {
                $docs[$d['path']] = ['strokes' => $d['strokes']];
            }
        }
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="pdf-stift-notizen-' . date('Y-m-d') . '.json"');
        echo json_encode(['app' => 'PDF-Stift', 'version' => PDFSTIFT_VERSION, 'created' => date('c'), 'docs' => $docs], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;

    case 'restore':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        if (($b['app'] ?? '') !== 'PDF-Stift' || !is_array($b['docs'] ?? null)) {
            fail('Das ist keine Sicherung von PDF-Stift.');
        }
        $n = 0;
        $missing = 0;
        foreach ($b['docs'] as $path => $d) {
            $rel = safe_rel((string) $path);
            if (!is_file(pdf_abs($rel))) {
                $missing++;
                continue;
            }
            $add = array_values((array) ($d['strokes'] ?? []));
            merge_notes($rel, $add, []);
            $n += count($add);
        }
        json_out(['ok' => true, 'strokes' => $n, 'missing' => $missing]);

    case 'pageop':
        // Seiten einfügen/drehen/verschieben/löschen: neues PDF kommt fertig aus dem Browser, Notizen ziehen hier mit
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) ($_POST['path'] ?? ''));
        $file = pdf_abs($rel);
        $map = json_decode((string) ($_POST['map'] ?? '[]'), true);
        $rot = json_decode((string) ($_POST['rot'] ?? '{}'), true);
        if (!is_array($map) || !is_array($rot)) {
            fail('Ungültige Seitenzuordnung.');
        }
        pdf_take_upload($rel, $file);
        remap_notes($rel, $map, $rot);
        json_out(['ok' => true, 'mtime' => filemtime($file), 'size' => filesize($file)]);

    case 'ncls':
        $rel = safe_rel((string) ($_GET['path'] ?? ''), true);
        $r = nc_browse($rel);
        if (isset($r['error'])) {
            fail($r['error'], 502);
        }
        json_out($r);

    case 'ncfetch':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        @set_time_limit(300);
        [$local, $err] = nc_fetch_any($rel);
        if ($err !== '') {
            fail($err, 502);
        }
        json_out(['ok' => true, 'path' => $local]);

    case 'ncmkdir':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        $err = nc_mkdir($rel);
        if ($err !== '') {
            fail($err, 502);
        }
        json_out(['ok' => true, 'path' => $rel]);

    case 'ncupload':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        @set_time_limit(600);
        $folder = safe_rel((string) ($_POST['folder'] ?? ''), true);
        $f = $_FILES['files'] ?? null;
        if (!$f || !is_array($f['name'])) {
            fail('Keine Dateien empfangen. Ist die Datei größer als upload_max_filesize?');
        }
        $saved = [];
        $errors = [];
        foreach ($f['name'] as $i => $orig) {
            if ($f['error'][$i] !== UPLOAD_ERR_OK || (string) file_get_contents($f['tmp_name'][$i], false, null, 0, 5) !== '%PDF-') {
                $errors[] = basename((string) $orig) . ': keine gültige PDF';
                continue;
            }
            $name = ltrim(preg_replace('/[\/\\\\\x00-\x1F]/', '_', basename((string) $orig)), '.');
            if (!preg_match('/\.pdf$/i', $name)) {
                $name .= '.pdf';
            }
            $e = nc_upload_file($folder, $name, $f['tmp_name'][$i]);
            if ($e !== '') {
                $errors[] = $name . ': ' . $e;
            } else {
                $saved[] = ltrim(($folder !== '' ? $folder . '/' : '') . $name, '/');
            }
        }
        json_out(['saved' => $saved, 'errors' => $errors]);

    // ---- OneDrive
    case 'odget':
        json_out(od_public(od_cfg()));

    case 'odset':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $c = od_cfg();
        $cid = trim((string) ($b['clientId'] ?? ''));
        if (!preg_match('/^[0-9a-fA-F-]{36}$/', $cid)) {
            fail('Die Anwendungs-ID hat das Format 1a2b3c4d-…-… (36 Zeichen). Du findest sie in der App-Registrierung unter „Übersicht“.');
        }
        if (($c['client_id'] ?? '') !== $cid || ($c['tenant'] ?? 'common') !== ($b['tenant'] ?? 'common')) {
            $c = ['tags' => $c['tags'] ?? []];
        }
        $c['client_id'] = $cid;
        $c['tenant'] = preg_match('/^[a-z0-9.-]{3,80}$/i', (string) ($b['tenant'] ?? '')) ? (string) $b['tenant'] : 'common';
        $c['folder'] = trim((string) ($b['folder'] ?? ''), " /");
        od_save($c);
        json_out(od_public($c));

    case 'odlogin':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $r = od_device_start();
        if (isset($r['error'])) {
            fail($r['error'], 502);
        }
        json_out($r);

    case 'odpoll':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        json_out(od_device_poll());

    case 'oddel':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $c = od_cfg();
        unset($c['refresh_token'], $c['access_token'], $c['user']);
        od_save($c);
        json_out(od_public($c));

    case 'odls':
        $r = od_browse(safe_rel((string) ($_GET['path'] ?? ''), true));
        if (isset($r['error'])) {
            fail($r['error'], 502);
        }
        json_out($r);

    case 'odfetch':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        [$local, $err] = od_fetch(safe_rel((string) (body()['path'] ?? '')));
        if ($err !== '') {
            fail($err, 502);
        }
        json_out(['ok' => true, 'path' => $local]);

    case 'odmkdir':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        $err = od_mkdir($rel);
        if ($err !== '') {
            fail($err, 502);
        }
        json_out(['ok' => true, 'path' => $rel]);

    case 'odupload':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        @set_time_limit(900);
        $folder = safe_rel((string) ($_POST['folder'] ?? ''), true);
        $f = $_FILES['files'] ?? null;
        if (!$f || !is_array($f['name'])) {
            fail('Keine Dateien empfangen. Ist die Datei größer als upload_max_filesize?');
        }
        $saved = [];
        $errors = [];
        foreach ($f['name'] as $i => $orig) {
            $ext = strtolower((string) pathinfo((string) $orig, PATHINFO_EXTENSION));
            if ($f['error'][$i] !== UPLOAD_ERR_OK || ($ext !== 'pdf' && !in_array($ext, OD_OFFICE, true))) {
                $errors[] = basename((string) $orig) . ': nur PDF, Word oder PowerPoint';
                continue;
            }
            $name = ltrim(preg_replace('/[\/\\\\\x00-\x1F]/', '_', basename((string) $orig)), '.');
            [$local, $e] = od_upload($folder, $name, $f['tmp_name'][$i]);
            if ($e !== '') {
                $errors[] = $name . ': ' . $e;
            } else {
                $saved[] = $local;
            }
        }
        json_out(['saved' => $saved, 'errors' => $errors]);

    // ---- PDFs im Hintergrund verkleinern
    case 'shrinkset':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $s = shrink_state();
        $b = body();
        if (array_key_exists('auto', $b)) {
            $s['auto'] = !empty($b['auto']);
        }
        if (array_key_exists('ncBack', $b)) {
            $s['ncBack'] = !empty($b['ncBack']);
        }
        shrink_save($s);
        json_out(shrink_public(list_pdfs()['files']));

    case 'shrinkundo':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        @set_time_limit(120);
        json_out(shrink_undo_batch(25));

    case 'shrinknext':
        // genau eine PDF bearbeiten (die größte noch nicht geprüfte) – der Browser ruft das nacheinander auf
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $lock = fopen(storage() . '/shrink.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            json_out(['busy' => true]);
        }
        ignore_user_abort(true);
        $want = (string) (body()['path'] ?? '');
        $files = list_pdfs()['files'];
        $cand = shrink_candidates($files, shrink_state());
        if ($want !== '') {
            $cand = array_values(array_filter($cand, fn ($f) => $f['path'] === safe_rel($want)));
        }
        if (!$cand || !shrink_caps()['ok']) {
            json_out(['done' => true] + shrink_public($files));
        }
        $f = $cand[0];
        $r = shrink_pdf($f['path']);
        flock($lock, LOCK_UN);
        json_out(['path' => $f['path']] + $r + ['info' => shrink_public(list_pdfs()['files'])]);

    // ---- Volltextsuche über alle PDFs
    case 'search':
        $q = trim((string) ($_GET['q'] ?? ''));
        $files = list_pdfs()['files'];
        $known = array_flip(array_column($files, 'path'));
        foreach (list_boards() as $nbk) {
            foreach ($nbk['sections'] as $sk) {
                foreach ($sk['pages'] as $pk) {
                    $known[$pk['path']] = true;
                }
            }
        }
        $r = search_query($q);
        $r['docs'] = array_values(array_filter($r['docs'], fn ($x) => isset($known[$x['path']])));
        json_out($r + ['notes' => search_notes($q, $files), 'status' => index_status($files)]);

    case 'indexstatus':
        // für die automatische Texterkennung: welche PDFs sind Scans ohne Text?
        json_out(index_status());

    case 'indexcheck':
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $file = pdf_abs($rel);
        if (!is_file($file)) {
            fail('Datei nicht gefunden.', 404);
        }
        clearstatcache();
        $doc = index_doc($rel);
        $f = ['mtime' => filemtime($file), 'size' => filesize($file)];
        json_out(['ok' => (bool) search_db(), 'fresh' => index_fresh($doc, $f), 'pages' => (int) ($doc['pages'] ?? 0),
            'textpages' => (int) ($doc['textpages'] ?? 0), 'src' => $doc['src'] ?? '', 'mtime' => $f['mtime'], 'size' => $f['size']]);

    case 'indexput':
        // Text, den der Browser gelesen hat (pdf.js) oder aus der Texterkennung (OCR)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $rel = safe_rel((string) ($b['path'] ?? ''));
        $file = pdf_abs($rel);
        clearstatcache();
        if (!is_file($file)) {
            fail('Datei nicht gefunden.', 404);
        }
        if ((int) ($b['mtime'] ?? 0) !== filemtime($file) || (int) ($b['size'] ?? 0) !== filesize($file)) {
            json_out(['stale' => true]); // PDF hat sich inzwischen geändert
        }
        $pages = is_array($b['pages'] ?? null) ? array_slice($b['pages'], 0, 5000) : [];
        $pages = array_map(fn ($x) => is_string($x) ? $x : '', $pages);
        $src = in_array($b['src'] ?? '', ['pdfjs', 'ocr'], true) ? $b['src'] : 'pdfjs';
        json_out(index_put($rel, filemtime($file), filesize($file), $pages, $src));

    case 'indexrun':
        // „Jetzt erfassen“: ein Stück des Index aufbauen (sonst macht das der nächtliche Cronjob)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $lock = fopen(storage() . '/index.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            json_out(['busy' => true, 'status' => index_status()]);
        }
        $r = index_batch(20);
        flock($lock, LOCK_UN);
        json_out($r + ['status' => index_status()]);

    // ---- Notizbücher (unendliche Tafel)
    case 'boards':
        boards_reindex_once();
        json_out(['books' => list_boards()]);

    case 'nbnew':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $kind = (string) ($b['kind'] ?? 'page');
        if ($kind === 'nb') {
            [$nb] = nb_ensure((string) ($b['name'] ?? ''));
            json_out(['path' => NB_PREFIX . $nb]);
        }
        if ($kind === 'sec') {
            [$nb, $sec] = nb_ensure((string) ($b['nb'] ?? ''), (string) ($b['name'] ?? '') ?: 'Neuer Abschnitt');
            json_out(['path' => NB_PREFIX . $nb . '/' . $sec]);
        }
        $rel = board_create((string) ($b['nb'] ?? 'Notizbuch'), (string) ($b['sec'] ?? 'Allgemein'), (string) ($b['title'] ?? ''), ['bg' => in_array($b['bg'] ?? '', ['dots', 'grid', 'lines', 'plain'], true) ? $b['bg'] : 'dots'], (string) ($b['file'] ?? ''));
        json_out(['path' => $rel]);

    case 'nbrename':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        json_out(['path' => nb_rename((string) ($b['path'] ?? ''), (string) ($b['name'] ?? ''))]);

    case 'nbhist':
        // frühere Stände einer Notizseite (GET: Liste, POST: wiederherstellen)
        if ($method === 'POST') {
            $b = body();
            $rel = safe_rel((string) ($b['path'] ?? ''));
            if (!is_board($rel)) {
                fail('Ungültiger Pfad.');
            }
            json_out(board_restore($rel, (int) ($b['t'] ?? 0)));
        }
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        if (isset($_GET['t'])) {
            $f = nbhist_dir($rel) . '/' . (int) $_GET['t'] . '.json';
            json_out(['strokes' => is_board($rel) && is_file($f) ? ((json_decode((string) file_get_contents($f), true) ?: [])['strokes'] ?? new stdClass()) : new stdClass()]);
        }
        json_out(['list' => is_board($rel) ? board_history($rel) : []]);

    case 'nbmove':
        // Seite in einen anderen Abschnitt; danach optional neue Reihenfolge im Ziel
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $new = nb_move_page((string) ($b['path'] ?? ''), (string) ($b['to'] ?? ''));
        if (is_array($b['order'] ?? null)) {
            nb_order(array_map(fn ($p) => $p === ($b['path'] ?? '') ? $new : $p, $b['order']));
        }
        json_out(['path' => $new]);

    case 'nborder':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        nb_order((array) (body()['paths'] ?? []));
        json_out(['ok' => true]);

    case 'nbdel':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        nb_delete((string) (body()['path'] ?? ''));
        json_out(['ok' => true]);

    case 'nbset':
        // Seiteneinstellungen (Hintergrund)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $rel = safe_rel((string) ($b['path'] ?? ''));
        $file = board_abs($rel);
        if (!is_file($file)) {
            fail('Nicht gefunden.', 404);
        }
        $m = board_read($file);
        if (in_array($b['bg'] ?? '', ['dots', 'grid', 'lines', 'plain'], true)) {
            $m['bg'] = $b['bg'];
        }
        file_put_contents($file, json_encode($m, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        json_out(['ok' => true, 'meta' => $m]);

    case 'nbmeta':
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $file = board_abs($rel);
        if (!is_file($file)) {
            fail('Nicht gefunden.', 404);
        }
        json_out(board_read($file) + ['mtime' => filemtime($file)]);

    // ---- Präsentationen
    case 'decks':
        json_out(['decks' => deck_list()]);

    case 'deck':
        $p = (string) ($_GET['path'] ?? (body()['path'] ?? ''));
        if ($method === 'POST') {
            $b = body();
            if (!is_array($b['deck'] ?? null)) {
                fail('Keine Präsentation empfangen.');
            }
            json_out(deck_save($p, $b['deck'], (int) ($b['rev'] ?? 0)));
        }
        json_out(['deck' => deck_read($p)]);

    case 'decknew':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $src = (string) ($b['copy'] ?? '');
        json_out(deck_new((string) ($b['title'] ?? ''), $src !== '' ? deck_read($src) : null));

    case 'deckdel':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $f = deck_file((string) (body()['path'] ?? ''));
        if (is_file($f)) {
            @rename($f, $f . '.geloescht-' . date('Ymd-His'));
        }
        json_out(['ok' => true]);

    case 'imgput':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            fail('Kein Bild empfangen.');
        }
        $r = img_store_bytes((string) file_get_contents($f['tmp_name']));
        if (!$r) {
            fail('Das ist kein Bild (JPEG, PNG, GIF oder WebP) oder es ist zu groß.');
        }
        json_out($r);

    case 'img':
        $f = img_file((string) ($_GET['src'] ?? ''));
        if (!$f) {
            fail('Bild nicht gefunden.', 404);
        }
        $ext = pathinfo($f, PATHINFO_EXTENSION);
        header('Content-Type: ' . ['jpg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'][$ext]);
        header('Content-Length: ' . filesize($f));
        header('Cache-Control: private, max-age=31536000, immutable');
        header('X-Content-Type-Options: nosniff');
        readfile($f);
        exit;

    // ---- OneNote übernehmen
    case 'onls':
        try {
            json_out(['books' => on_notebooks()]);
        } catch (RuntimeException $e) {
            fail($e->getMessage(), 502);
        }

    case 'onpages':
        try {
            json_out(['pages' => on_pages((string) ($_GET['section'] ?? ''))]);
        } catch (RuntimeException $e) {
            fail($e->getMessage(), 502);
        }

    case 'onpage':
        try {
            json_out(on_page_content((string) ($_GET['id'] ?? '')));
        } catch (RuntimeException $e) {
            fail($e->getMessage(), 502);
        }

    case 'onsave':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        json_out(on_save(body()));

    // ---- Live-Mitschau (Steuerung)
    case 'livestart':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        if (!is_file(pdf_abs($rel))) {
            fail('Datei nicht gefunden.', 404);
        }
        $s = live_start($rel);
        json_out(['code' => $s['code']]);

    case 'livepush':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $code = strtoupper((string) ($b['code'] ?? ''));
        $s = live_read($code);
        if (!$s) {
            json_out(['ended' => true]);
        }
        if (isset($b['path'])) {
            $rel = safe_rel((string) $b['path']);
            if (is_file(pdf_abs($rel))) {
                $s['path'] = $rel;
            }
        }
        $s['page'] = max(0, min(100000, (int) ($b['page'] ?? $s['page'])));
        if (isset($b['strokes']) && is_array($b['strokes'])) {
            $s['strokes'] = array_values(array_filter(array_map('valid_stroke', array_slice($b['strokes'], 0, 3000))));
            $s['srev'] = (int) ($s['srev'] ?? 0) + 1;
        }
        // Strich, der gerade geschrieben wird
        if (array_key_exists('cur', $b)) {
            $s['cur'] = is_array($b['cur']) ? valid_stroke($b['cur']) : null;
        }
        if (isset($b['laser']) && is_array($b['laser'])) {
            // Laser: bis zu 20 Spuren aus Punkten [x, y, Alter in ms] (nur Zahlen)
            $laser = [];
            foreach (array_slice($b['laser'], 0, 20) as $tr) {
                if (!is_array($tr)) {
                    continue;
                }
                $pts = [];
                foreach (array_slice($tr, 0, 300) as $p) {
                    if (is_array($p) && count($p) >= 3 && is_numeric($p[0]) && is_numeric($p[1]) && is_numeric($p[2])) {
                        $pts[] = [round((float) $p[0], 1), round((float) $p[1], 1), (int) $p[2]];
                    }
                }
                if ($pts) {
                    $laser[] = $pts;
                }
            }
            $s['laser'] = $laser;
            $s['lt'] = (int) round(microtime(true) * 1000);
        }
        $s['rev'] = (int) $s['rev'] + 1;
        live_write($s);
        json_out(['ok' => true, 'viewers' => live_viewers($code)]);

    case 'livestop':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $s = live_read(strtoupper((string) (body()['code'] ?? '')));
        if ($s) {
            $s['ended'] = true;
            live_write($s);
        }
        json_out(['ok' => true]);

    case 'ncput':
        // beschriftete PDF in Nextcloud ablegen (Unterordner „Mit Notizen“)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $bin = (string) file_get_contents('php://input');
        if (substr($bin, 0, 5) !== '%PDF-') {
            fail('Ungültiges PDF.');
        }
        $err = nc_put_annotated($rel, $bin);
        if ($err !== '') {
            fail($err, 502);
        }
        json_out(['ok' => true]);

    case 'ncget':
        json_out(nc_public(nc_cfg()));

    case 'ncset':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $c = nc_cfg();
        $url = rtrim(trim((string) ($b['url'] ?? '')), '/');
        if (!preg_match('#^https?://[^\s/]+#i', $url)) {
            fail('Bitte die Adresse deiner Nextcloud angeben, z. B. https://cloud.example.org');
        }
        $url = preg_replace('#/(index\.php)?(/apps/files.*)?$#', '', $url);
        $new = [
            'url'    => $url,
            'user'   => trim((string) ($b['user'] ?? '')),
            'pass'   => (string) ($b['pass'] ?? '') !== '' ? (string) $b['pass'] : (string) ($c['pass'] ?? ''),
            'folder' => trim((string) ($b['folder'] ?? 'PDF-Stift'), " /"),
            'export' => !empty($b['export']),
        ];
        if ($new['user'] === '' || $new['pass'] === '') {
            fail('Benutzername und App-Passwort werden gebraucht.');
        }
        [, $err] = nc_list($new, '');
        if ($err !== '') {
            fail($err);
        }
        if (($c['url'] ?? '') === $new['url'] && ($c['user'] ?? '') === $new['user'] && ($c['folder'] ?? '') === $new['folder']) {
            $new['etags'] = $c['etags'] ?? [];
        }
        nc_save($new);
        json_out(nc_public($new));

    case 'ncdel':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        @unlink(nc_file());
        json_out(nc_public([]));

    case 'ncsync':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        json_out(nc_sync(35) + ['nc' => nc_public(nc_cfg())]);

    case 'share':
        $saved = save_uploads('Eingang', $_FILES['files'] ?? null);
        header('Location: ./?shared=' . count($saved), true, 303);
        exit;

    case 'pdf':
        $file = pdf_abs((string) ($_GET['path'] ?? ''));
        if (!is_file($file)) {
            fail('Datei nicht gefunden.', 404);
        }
        $etag = '"' . filemtime($file) . '-' . filesize($file) . '"';
        header('ETag: ' . $etag);
        header('Cache-Control: private, no-cache');
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            http_response_code(304);
            exit;
        }
        $name = basename($file);
        $size = filesize($file);
        header('Content-Type: application/pdf');
        header('Accept-Ranges: bytes');
        header('X-Content-Type-Options: nosniff');
        $disp = !empty($_GET['dl']) ? 'attachment' : 'inline';
        header("Content-Disposition: $disp; filename=\"" . preg_replace('/[^\w .()-]/u', '_', $name) . "\"; filename*=UTF-8''" . rawurlencode($name));
        // Teilabruf (z. B. nur die erste Seite für das Vorschaubild)
        if (preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $m) && ($m[1] !== '' || $m[2] !== '')) {
            $from = $m[1] === '' ? max(0, $size - (int) $m[2]) : (int) $m[1];
            $to = ($m[1] === '' || $m[2] === '') ? $size - 1 : min((int) $m[2], $size - 1);
            if ($from > $to || $from >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */$size");
                exit;
            }
            http_response_code(206);
            header("Content-Range: bytes $from-$to/$size");
            header('Content-Length: ' . ($to - $from + 1));
            $fh = fopen($file, 'rb');
            fseek($fh, $from);
            $left = $to - $from + 1;
            while ($left > 0 && !feof($fh)) {
                $chunk = fread($fh, (int) min(65536, $left));
                echo $chunk;
                $left -= strlen($chunk);
            }
            fclose($fh);
            exit;
        }
        header('Content-Length: ' . $size);
        readfile($file);
        exit;

    case 'notes':
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $doc = read_notes($rel);
        if (!is_board($rel) && is_file(pdf_abs($rel))) {
            clearstatcache();
            $doc['file'] = ['mtime' => filemtime(pdf_abs($rel)), 'size' => filesize(pdf_abs($rel))];
        }
        json_out($doc);

    case 'burn':
        // Notizen fest in die PDF schreiben: neue PDF kommt fertig aus dem Browser, die eingebrannten Striche werden aus der Notizebene entfernt
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) ($_POST['path'] ?? ''));
        $file = pdf_abs($rel);
        $ids = json_decode((string) ($_POST['ids'] ?? '[]'), true);
        if (!is_array($ids)) {
            fail('Daten fehlen.', 400);
        }
        clearstatcache();
        if (!empty($_POST) && is_file($file) && (int) ($_POST['baseSize'] ?? -1) !== filesize($file)) {
            fail('Die PDF wurde inzwischen geändert – bitte erneut versuchen.', 409);
        }
        pdf_take_upload($rel, $file, ' Die Notizen bleiben gespeichert.');
        $doc = merge_notes($rel, [], array_values(array_filter(array_map('strval', $ids))));
        $nc = '';
        if (!empty(nc_cfg()['etags'][$rel])) {
            $nc = shrink_nc_back($rel, $file) ?: 'ok';
        }
        json_out(['ok' => true, 'mtime' => filemtime($file), 'size' => filesize($file), 'notes' => $doc, 'nextcloud' => $nc]);

    case 'sync':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $rel = safe_rel((string) ($b['path'] ?? ''));
        if (!is_file(doc_abs($rel))) {
            fail('Datei nicht gefunden.', 404);
        }
        $add = is_array($b['add'] ?? null) ? $b['add'] : [];
        $del = is_array($b['del'] ?? null) ? $b['del'] : [];
        if (is_board($rel) && ($add || $del)) {
            board_snapshot($rel);
        }
        $res = merge_notes($rel, $add, $del);
        if (is_board($rel) && ($add || $del)) {
            board_changed($rel);
        }
        json_out($res);

    case 'prefs':
        // kleine Einstellungen, die auf allen Geräten gelten (z. B. die eigene Unterschrift)
        $pf = storage() . '/prefs.json';
        $prefs = is_file($pf) ? (json_decode((string) file_get_contents($pf), true) ?: []) : [];
        if ($method === 'POST') {
            $b = body();
            // Einstellungen für alle Geräte (Datei → Einstellungen)
            if (isset($b['settings']) && is_array($b['settings'])) {
                $st = (array) ($prefs['settings'] ?? []);
                foreach (['redactPurge', 'autoOcr', 'usage'] as $k) {
                    if (array_key_exists($k, $b['settings'])) {
                        $st[$k] = (bool) $b['settings'][$k];
                    }
                }
                if (array_key_exists('keepVersions', $b['settings'])) {
                    $st['keepVersions'] = max(0, min(10, (int) $b['settings']['keepVersions']));
                }
                $prefs['settings'] = $st;
            }
            // Einstellungen der Android-App (Werkzeugleiste, Stifte, Seitenleiste …) – damit sie nach einer Neuinstallation wieder da sind
            if (isset($b['app']) && is_array($b['app'])) {
                $app = [];
                foreach (array_slice($b['app'], 0, 80, true) as $k => $v) {
                    if (is_string($k) && preg_match('/^[A-Za-z0-9_:.-]{1,40}$/', $k) && (is_scalar($v) || $v === null) && strlen((string) $v) <= 4000) {
                        $app[$k] = $v;
                    }
                }
                $prefs['app'] = $app;
                $prefs['appT'] = time();
            }
            // Oberfläche (Browser und Windows-App): Leisten, Favoriten, Farben … – gilt auf allen Geräten; je Eintrag gewinnt der neuere Stand
            if (isset($b['ui']) && is_array($b['ui'])) {
                $ui = (array) ($prefs['ui'] ?? []);
                $uiT = (array) ($prefs['uiT'] ?? []);
                $ts = (array) ($b['uiT'] ?? []);
                foreach (array_slice($b['ui'], 0, 60, true) as $k => $v) {
                    if (!is_string($k) || !preg_match('/^[A-Za-z0-9_]{1,30}$/', $k)) continue;
                    $enc = json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    if ($enc === false || strlen($enc) > 30000) continue;
                    $t = (int) ($ts[$k] ?? 0);
                    if ($t <= (int) ($uiT[$k] ?? 0)) continue;
                    $ui[$k] = $v;
                    $uiT[$k] = $t;
                }
                $prefs['ui'] = $ui;
                $prefs['uiT'] = $uiT;
            }
            foreach (['signature', 'initials'] as $k) {
                if (array_key_exists($k, $b)) {
                    $v = $b[$k];
                    if ($v === null || $v === '') {
                        unset($prefs[$k]);
                    } elseif (is_array($v) && img_file((string) ($v['src'] ?? ''))) {
                        $prefs[$k] = ['src' => (string) $v['src'], 'w' => (int) ($v['w'] ?? 0), 'h' => (int) ($v['h'] ?? 0)];
                    }
                }
            }
            file_put_contents($pf, json_encode($prefs, JSON_UNESCAPED_SLASHES), LOCK_EX);
        }
        json_out($prefs);

    case 'versions':
        // frühere Fassungen einer PDF (vor Seitenänderungen, Einschreiben, Verkleinern)
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        $out = [];
        foreach ([storage('backup'), storage('backup') . '/verkleinert'] as $dir) {
            foreach (glob($dir . '/' . sha1($rel) . '-*') ?: [] as $f) {
                $t = preg_match('/^[a-f0-9]{40}-(\d{8}-\d{6})-/', basename($f), $m) ? DateTime::createFromFormat('Ymd-His', $m[1]) : false;
                $out[] = ['id' => basename($dir) . '/' . basename($f), 'time' => $t ? $t->getTimestamp() : filemtime($f), 'size' => filesize($f), 'kind' => basename($dir) === 'verkleinert' ? 'vor dem Verkleinern' : ''];
            }
        }
        usort($out, fn ($x, $y) => $y['time'] <=> $x['time']);
        json_out(['versions' => $out]);

    case 'version':
    case 'verrestore':
        $rel = safe_rel((string) ($_GET['path'] ?? ($a === 'verrestore' ? (body()['path'] ?? '') : '')));
        $id = (string) ($_GET['id'] ?? ($a === 'verrestore' ? (body()['id'] ?? '') : ''));
        if (!preg_match('#^(backup|verkleinert)/([a-f0-9]{40})-[\w.() -]+$#u', $id, $m) || $m[2] !== sha1($rel)) {
            fail('Unbekannte Fassung.', 404);
        }
        $vf = ($m[1] === 'backup' ? storage('backup') : storage('backup') . '/verkleinert') . '/' . substr($id, strlen($m[1]) + 1);
        if (!is_file($vf)) {
            fail('Fassung nicht gefunden.', 404);
        }
        if ($a === 'version') {
            header('Content-Type: application/pdf');
            header('Content-Length: ' . filesize($vf));
            header('Cache-Control: private, max-age=86400');
            readfile($vf);
            exit;
        }
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $file = pdf_abs($rel);
        if (!is_file($file)) {
            fail('Datei nicht gefunden.', 404);
        }
        copy($file, storage('backup') . '/' . sha1($rel) . '-' . date('Ymd-His') . '-' . preg_replace('/[^\w.-]/', '_', basename($rel)));
        copy($vf, $file);
        clearstatcache();
        foreach (glob(storage('thumbs') . '/' . sha1($rel) . '-*.jpg') ?: [] as $t) {
            @unlink($t);
        }
        json_out(['ok' => true, 'mtime' => filemtime($file), 'size' => filesize($file)]);

    case 'convert':
        // Office-Datei → PDF zurückgeben, ohne sie in der Bibliothek abzulegen (für „Zusammenfügen“)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $up = $_FILES['file'] ?? null;
        if (!$up || $up['error'] !== UPLOAD_ERR_OK) {
            fail('Keine Datei empfangen.');
        }
        $ext = strtolower((string) pathinfo((string) $up['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, OFFICE_EXT, true)) {
            fail('Nur Word, Excel oder PowerPoint.');
        }
        @set_time_limit(300);
        $conv = storage('tmp') . '/' . bin2hex(random_bytes(8)) . '.pdf';
        $err = office_to_pdf($up['tmp_name'], $ext, $conv);
        if ($err !== '') {
            @unlink($conv);
            fail($err, 502);
        }
        header('Content-Type: application/pdf');
        header('Content-Length: ' . filesize($conv));
        readfile($conv);
        @unlink($conv);
        exit;

    case 'meta':
        if ($method === 'POST') {
            $b = body();
            $m = meta_update(function (array $m) use ($b) {
                if (isset($b['path'], $b['tags']) && is_array($b['tags'])) {
                    $p = safe_rel((string) $b['path']);
                    $t = meta_clean_tags($b['tags']);
                    if ($t) {
                        $m['docs'][$p]['tags'] = $t;
                    } else {
                        unset($m['docs'][$p]);
                    }
                }
                if (isset($b['mark']) && is_array($b['mark'])) {
                    $p = safe_rel((string) ($b['mark']['path'] ?? ''));
                    $pg = max(0, (int) ($b['mark']['page'] ?? 0));
                    $m['marks'] = array_values(array_filter($m['marks'], fn ($k) => !($k['path'] === $p && (int) $k['page'] === $pg)));
                    if (empty($b['mark']['remove'])) {
                        array_unshift($m['marks'], ['path' => $p, 'page' => $pg, 'title' => mb_substr(trim((string) ($b['mark']['title'] ?? '')), 0, 200), 't' => time()]);
                    }
                    $m['marks'] = array_slice($m['marks'], 0, 2000);
                }
                return $m;
            });
            json_out($m);
        }
        json_out(meta_read());

    case 'pgtext':
        // Text einzelner PDF-Seiten aus dem Suchindex (Suche auf Notizseiten in übernommenen Folien)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $refs = array_slice((array) (body()['refs'] ?? []), 0, 400);
        json_out(['texts' => array_map(fn ($r) => is_array($r) && is_string($r[0] ?? null) ? index_page_text(safe_rel($r[0]), (int) ($r[1] ?? 0)) : '', $refs)]);

    case 'backlinks':
        json_out(['links' => meta_backlinks(safe_rel((string) ($_GET['path'] ?? '')))]);

    case 'ncbackup':
        // Sicherung nach Nextcloud: Stand, ein/aus, „jetzt sichern“ (in Häppchen, die App ruft wiederholt auf)
        if ($method === 'POST') {
            $b = body();
            if (array_key_exists('auto', $b)) {
                $st = ncb_state();
                $st['auto'] = (bool) $b['auto'];
                ncb_save($st);
            }
            if (!empty($b['run'])) {
                $lk = fopen(storage() . '/ncbackup.lock', 'c');
                if (!$lk || !flock($lk, LOCK_EX | LOCK_NB)) {
                    json_out(['busy' => true] + ncb_public());
                }
                $r = ncb_run(35);
                flock($lk, LOCK_UN);
                json_out($r + ncb_public());
            }
        }
        json_out(ncb_public());

    case 'srvupdate':
        // Stand anzeigen (GET) oder einspielen (POST)
        if ($method === 'POST') {
            $lk = fopen(storage() . '/selfupdate.lock', 'c');
            if (!$lk || !flock($lk, LOCK_EX | LOCK_NB)) {
                fail('Das Update läuft bereits.', 409);
            }
            $r = su_install();
            flock($lk, LOCK_UN);
            if (isset($r['error'])) {
                fail($r['error'], 500);
            }
            json_out($r);
        }
        json_out(su_status());

    case 'ncbverify':
        json_out(ncb_verify());

    case 'ncbrestore':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $lk = fopen(storage() . '/ncbackup.lock', 'c');
        if (!$lk || !flock($lk, LOCK_EX | LOCK_NB)) {
            json_out(['busy' => true]);
        }
        $r = ncb_restore(30);
        flock($lk, LOCK_UN);
        json_out($r);

    case 'protect':
        // Kopie mit Passwort verschlüsseln und gleich zurückgeben (nichts wird gespeichert)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $up = $_FILES['pdf'] ?? null;
        $pw = (string) ($_POST['pw'] ?? '');
        if (!$up || $up['error'] !== UPLOAD_ERR_OK || (string) file_get_contents($up['tmp_name'], false, null, 0, 5) !== '%PDF-') {
            fail('PDF fehlt.', 400);
        }
        if (strlen($pw) < 4 || strlen($pw) > 128 || preg_match('/[\x00-\x1F]/', $pw)) {
            fail('Ungültiges Passwort.');
        }
        @set_time_limit(300);
        $dir = storage('tmp');
        $id = bin2hex(random_bytes(8));
        $in = "$dir/p-$id-in.pdf";
        $out = "$dir/p-$id-out.pdf";
        $args = "$dir/p-$id.args";
        move_uploaded_file($up['tmp_name'], $in);
        $owner = bin2hex(random_bytes(16));
        // Passwörter über eine Argumentdatei, damit sie nicht in der Prozessliste stehen
        $how = '';
        if (qpdf_path() !== '') {
            file_put_contents($args, implode("\n", ['--encrypt', $pw, $owner, '256', '--', $in, $out]) . "\n");
            @chmod($args, 0600);
            [$code] = run_cmd([qpdf_path(), '@' . $args], 240, $dir);
            $how = 'AES-256';
        } elseif (gs_path() !== '') {
            file_put_contents($args, implode("\n", ['-sOwnerPassword=' . $owner, '-sUserPassword=' . $pw]) . "\n");
            @chmod($args, 0600);
            [$code] = run_cmd([gs_path(), '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-dPassThroughJPEGImages=true', '-dAutoRotatePages=/None',
                '-dCompatibilityLevel=1.6', '-dEncryptionR=3', '-dKeyLength=128', '-dPermissions=-4', '@' . $args, '-sOutputFile=' . $out, $in], 240, $dir);
            $how = 'RC4-128';
        } else {
            @unlink($in);
            fail('Zum Verschlüsseln braucht der Server Ghostscript oder qpdf.', 501);
        }
        @unlink($args);
        @unlink($in);
        if (!is_file($out) || filesize($out) < 100) {
            @unlink($out);
            fail('Verschlüsseln fehlgeschlagen.', 500);
        }
        header('Content-Type: application/pdf');
        header('Content-Length: ' . filesize($out));
        header('Cache-Control: no-store');
        header('X-PDFStift-Crypt: ' . $how);
        readfile($out);
        @unlink($out);
        exit;

    case 'upload':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $folder = safe_rel((string) ($_POST['folder'] ?? ($tokenOk ? 'Eingang' : '')), true);
        if (empty($_FILES['files']['name'])) {
            fail('Keine Dateien empfangen. Ist die Datei größer als upload_max_filesize?');
        }
        $GLOBALS['upload_errors'] = [];
        $saved = save_uploads($folder, $_FILES['files'], isset($_POST['filename']) ? (string) $_POST['filename'] : null);
        json_out(['saved' => $saved, 'errors' => $GLOBALS['upload_errors']]);

    case 'purgebackup':
        // nach dem Schwärzen: frühere Fassungen dieser PDF endgültig löschen (Einstellung „Beim Schwärzen alte Fassungen löschen“)
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) (body()['path'] ?? ''));
        $n = 0;
        foreach ([storage('backup'), storage('backup') . '/verkleinert'] as $dir) {
            foreach (glob($dir . '/' . sha1($rel) . '-*') ?: [] as $f) {
                if (is_file($f)) {
                    // erst überschreiben, dann löschen
                    $h = @fopen($f, 'r+');
                    if ($h) {
                        $len = filesize($f);
                        for ($o = 0; $o < $len; $o += 1048576) {
                            fwrite($h, str_repeat("\0", (int) min(1048576, $len - $o)));
                        }
                        fclose($h);
                    }
                    @unlink($f);
                    $n++;
                }
            }
        }
        json_out(['ok' => true, 'deleted' => $n]);

    case 'audiols':
        // Tonaufnahmen zu einer PDF
        $rel = safe_rel((string) ($_GET['path'] ?? ''));
        json_out(['recs' => audio_list($rel)]);

    case 'audioput':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $rel = safe_rel((string) ($_POST['path'] ?? ''));
        $id = (string) ($_POST['id'] ?? '');
        if (!preg_match('/^[a-z0-9]{8,40}$/', $id)) {
            fail('Ungültige Aufnahme.');
        }
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            fail('Keine Aufnahme empfangen. Ist die Datei größer als upload_max_filesize?');
        }
        $head = (string) file_get_contents($f['tmp_name'], false, null, 0, 12);
        if (substr($head, 4, 4) !== 'ftyp') {
            fail('Das ist keine Tonaufnahme (m4a).');
        }
        if (!move_uploaded_file($f['tmp_name'], storage('audio') . '/' . $id . '.m4a')) {
            fail('Aufnahme konnte nicht gespeichert werden.', 500);
        }
        audio_index_update(function (array $ix) use ($rel, $id) {
            $list = array_values(array_filter($ix[$rel] ?? [], fn($r) => ($r['id'] ?? '') !== $id));
            $list[] = ['id' => $id, 't' => max(0, (int) ($_POST['t'] ?? 0)), 'dur' => max(0, (int) ($_POST['dur'] ?? 0)), 'name' => mb_substr(trim((string) ($_POST['name'] ?? '')), 0, 120)];
            $ix[$rel] = $list;
            return $ix;
        });
        json_out(['ok' => true, 'recs' => audio_list($rel)]);

    case 'audio':
        $id = (string) ($_GET['id'] ?? '');
        $file = storage('audio') . '/' . $id . '.m4a';
        if (!preg_match('/^[a-z0-9]{8,40}$/', $id) || !is_file($file)) {
            fail('Aufnahme nicht gefunden.', 404);
        }
        session_write_close();
        header('Content-Type: audio/mp4');
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: private, max-age=31536000, immutable');
        readfile($file);
        exit;

    case 'audiodel':
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $rel = safe_rel((string) ($b['path'] ?? ''));
        $id = (string) ($b['id'] ?? '');
        audio_index_update(function (array $ix) use ($rel, $id) {
            $ix[$rel] = array_values(array_filter($ix[$rel] ?? [], fn($r) => ($r['id'] ?? '') !== $id));
            if (!$ix[$rel]) {
                unset($ix[$rel]);
            }
            return $ix;
        });
        if (preg_match('/^[a-z0-9]{8,40}$/', $id)) {
            @unlink(storage('audio') . '/' . $id . '.m4a');
        }
        json_out(['ok' => true, 'recs' => audio_list($rel)]);

    case 'appreport':
        // „Fehler melden“ aus der Android-App: Text ins Protokoll, Bildschirmfoto daneben ablegen
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $txt = substr(trim((string) ($_POST['text'] ?? '')), 0, 4000);
        $info = substr(trim((string) ($_POST['info'] ?? '')), 0, 600);
        $shot = '';
        $f = $_FILES['shot'] ?? null;
        if ($f && $f['error'] === UPLOAD_ERR_OK && $f['size'] < 3000000) {
            $bin = (string) file_get_contents($f['tmp_name']);
            if (substr($bin, 0, 2) === "\xFF\xD8") {
                $dir = storage('reports');
                $shot = date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.jpg';
                file_put_contents($dir . '/' . $shot, $bin);
                $all = glob($dir . '/*.jpg') ?: [];
                sort($all);
                foreach (array_slice($all, 0, max(0, count($all) - 40)) as $old) {
                    @unlink($old);
                }
            }
        }
        $lf = storage() . '/applog.txt';
        file_put_contents($lf, "==== " . date('Y-m-d H:i:s') . "\nFEHLERMELDUNG\n" . $info . "\n" . $txt . ($shot !== '' ? "\n[Bild: " . $shot . "]" : '') . "\n", FILE_APPEND | LOCK_EX);
        json_out(['ok' => true]);

    case 'usage':
        // Nutzungsprotokoll: welche Werkzeuge, Fehler, Dauer – ohne Dokumentinhalte und ohne Dateinamen
        if ($method !== 'POST') {
            fail('POST erwartet.', 405);
        }
        $b = body();
        $ev = is_array($b['ev'] ?? null) ? array_slice($b['ev'], 0, 500) : [];
        $dev = preg_replace('/[^a-z0-9.\- ]/i', '', substr((string) ($b['dev'] ?? ''), 0, 30));
        $ver = preg_replace('/[^0-9.]/', '', substr((string) ($b['v'] ?? ''), 0, 20));
        $lines = '';
        foreach ($ev as $e) {
            if (!is_array($e)) {
                continue;
            }
            $k = (string) ($e['k'] ?? '');
            if (!in_array($k, ['tool', 'err', 'perf'], true)) {
                continue;
            }
            $o = ['t' => min(time() + 60, max(0, (int) ($e['t'] ?? time()))), 'k' => $k, 'n' => substr(preg_replace('/[\x00-\x1f]+/', ' ', (string) ($e['n'] ?? '')), 0, 120), 'd' => $dev, 'v' => $ver];
            if (isset($e['ms']) && is_numeric($e['ms'])) {
                $o['ms'] = max(0, min(36000000, (int) $e['ms']));
            }
            if (isset($e['x']) && $e['x'] !== '') {
                $o['x'] = substr(preg_replace('/[\x00-\x1f]+/', ' ', (string) $e['x']), 0, 300);
            }
            $lines .= json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
        }
        if ($lines !== '') {
            $dir = storage('usage');
            file_put_contents($dir . '/' . date('Y-m') . '.jsonl', $lines, FILE_APPEND | LOCK_EX);
            // nur die letzten 6 Monate aufheben
            $all = glob($dir . '/*.jsonl') ?: [];
            sort($all);
            foreach (array_slice($all, 0, max(0, count($all) - 6)) as $old) {
                @unlink($old);
            }
        }
        json_out(['ok' => true]);

    case 'usagereport':
        $days = max(1, min(180, (int) ($_GET['days'] ?? 30)));
        header('Content-Type: text/plain; charset=utf-8');
        echo usage_report($days);
        exit;

    default:
        fail('Unbekannte Aktion.', 404);
}
