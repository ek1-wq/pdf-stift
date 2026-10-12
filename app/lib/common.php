<?php
declare(strict_types=1);

const PDFSTIFT_VERSION = '1.66.6';

/**
 * Freie Ausgabe („local“): Die Windows-App startet einen eigenen kleinen PHP-Server nur für sich selbst.
 * Bibliothek = normaler Ordner auf dem PC, keine Anmeldung, keine Server-Dienste (Nextcloud, OneDrive, OneNote, Live-Mitschau).
 * Die App übergibt den Zugangsschlüssel und die Ordner über Umgebungsvariablen.
 */
function local_key(): string
{
    static $k = null;
    return $k ??= (string) getenv('PDFSTIFT_LOCAL_KEY');
}
function is_local(): bool
{
    return local_key() !== '';
}
function edition(): string
{
    // „free“: freie Ausgabe auf einem eigenen Webserver (ohne die Dienste der eigenen Ausgabe)
    return is_local() ? 'local' : (is_file(__DIR__ . '/onenote.php') ? 'server' : 'free');
}
/** Sprache der Oberfläche: Cookie, sonst Deutsch (eigene Ausgabe) bzw. Englisch (freie Ausgabe) */
function ui_lang(): string
{
    $l = (string) ($_COOKIE['pdfstift_lang'] ?? '');
    if (in_array($l, ['de', 'en'], true)) {
        return $l;
    }
    if (is_local()) {
        return (string) (getenv('PDFSTIFT_LANG') ?: 'en');
    }
    // Demo und freie Ausgabe auf einem Webserver: Sprache des Browsers
    if (isset(cfg()['demo']) || edition() === 'free') {
        return str_starts_with(strtolower((string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')), 'de') ? 'de' : 'en';
    }
    return 'de';
}

function cfg(): array
{
    static $c = null;
    if ($c === null) {
        $file = dirname(__DIR__) . '/config.php';
        $c = is_file($file) ? (array) require $file : [];
        if (is_local()) {
            $c = ['password_hash' => 'local', 'storage' => (string) getenv('PDFSTIFT_DATA'), 'library' => (string) getenv('PDFSTIFT_LIBRARY')];
        }
        $c += [
            'password_hash' => '',
            'storage'       => dirname(__DIR__) . '/storage',
            'library'       => '',
            'session_days'  => 60,
        ];
    }
    return $c;
}

function storage(string $sub = ''): string
{
    $dir = ($sub === 'pdfs' && cfg()['library'] !== '') ? rtrim(str_replace('\\', '/', cfg()['library']), '/')
        : rtrim(str_replace('\\', '/', cfg()['storage']), '/') . ($sub !== '' ? '/' . $sub : '');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    // Datenordner nie direkt über das Web erreichbar (falls die .htaccess fehlt oder PDF-Stift in einem Unterordner liegt)
    $root = rtrim(str_replace('\\', '/', cfg()['storage']), '/');
    if ($sub === '' && !is_local() && !is_file($root . '/.htaccess')) {
        @file_put_contents($root . '/.htaccess', "Require all denied\nDeny from all\n");
    }
    return $dir;
}

function needs_setup(): bool
{
    return cfg()['password_hash'] === '';
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $days = (int) cfg()['session_days'];
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_save_path(storage('sessions'));
    ini_set('session.gc_maxlifetime', (string) ($days * 86400));
    ini_set('session.use_strict_mode', '1');
    // in einem Unterordner (z. B. /demo/): eigenes Cookie, damit es sich nicht mit einer zweiten Installation auf derselben Domain überschneidet
    $path = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
    session_name($path === '/' ? 'pdfstift' : 'pdfstift_' . substr(md5($path), 0, 8));
    session_set_cookie_params([
        'lifetime' => $days * 86400,
        'path'     => $path,
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function is_logged_in(): bool
{
    if (is_local()) {
        return hash_equals(local_key(), (string) ($_SERVER['HTTP_X_PDFSTIFT_LOCAL'] ?? ''));
    }
    start_session();
    return !empty($_SESSION['ok']);
}

function json_out(mixed $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $j = (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    // größere Antworten (Bibliothek, Notizen) gepackt schicken – spart auf langsamen Verbindungen viel Zeit
    if (strlen($j) > 4096 && function_exists('gzencode') && !ini_get('zlib.output_compression') && !headers_sent()
        && str_contains((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip')) {
        $z = gzencode($j, 5);
        if ($z !== false) {
            header('Content-Encoding: gzip');
            header('Vary: Accept-Encoding');
            header('Content-Length: ' . strlen($z));
            echo $z;
            exit;
        }
    }
    echo $j;
    exit;
}

function fail(string $message, int $code = 400): never
{
    json_out(['error' => $message], $code);
}

/** Normalises a relative path inside the PDF store and rejects anything that could escape it. */
function safe_rel(string $rel, bool $allowEmpty = false): string
{
    $rel = str_replace('\\', '/', trim($rel));
    $rel = trim($rel, '/');
    if ($rel === '') {
        if ($allowEmpty) {
            return '';
        }
        fail('Pfad fehlt.');
    }
    if (preg_match('/[\x00-\x1F\x7F]/', $rel)) {
        fail('Ungültiger Pfad.');
    }
    foreach (explode('/', $rel) as $seg) {
        if ($seg === '' || $seg === '.' || $seg === '..' || $seg[0] === '.') {
            fail('Ungültiger Pfad.');
        }
    }
    return $rel;
}

function pdf_abs(string $rel): string
{
    $rel = safe_rel($rel);
    if (!preg_match('/\.pdf$/i', $rel)) {
        fail('Nur PDF-Dateien.');
    }
    return storage('pdfs') . '/' . $rel;
}

function notes_file(string $rel): string
{
    return storage('notes') . '/' . sha1($rel) . '.json';
}

function empty_doc(string $rel): array
{
    return ['v' => 1, 'path' => $rel, 'rev' => 0, 'strokes' => new stdClass(), 'deleted' => new stdClass()];
}

function read_notes(string $rel): array
{
    $file = notes_file($rel);
    if (!is_file($file)) {
        return empty_doc($rel);
    }
    $doc = json_decode((string) file_get_contents($file), true);
    if (!is_array($doc)) {
        return empty_doc($rel);
    }
    $doc['strokes'] = $doc['strokes'] ?: new stdClass();
    $doc['deleted'] = $doc['deleted'] ?: new stdClass();
    return $doc;
}

function valid_stroke(mixed $s): ?array
{
    if (!is_array($s)) {
        return null;
    }
    $r = valid_stroke_inner($s);
    if ($r === null) {
        return null;
    }
    // Tonaufnahme: zu welcher Aufnahme und an welcher Stelle (ms) der Strich geschrieben wurde
    if (isset($s['au']) && is_array($s['au']) && count($s['au']) === 2 && is_string($s['au'][0]) && preg_match('/^[a-z0-9]{8,40}$/', $s['au'][0]) && is_numeric($s['au'][1])) {
        $r['au'] = [$s['au'][0], max(0, min(86400000, (int) $s['au'][1]))];
    }
    // Tafel (unendliches Notizbuch): Punkte sind relativ zu einem Ursprung o, gezeichnet bei Zoom z
    if (isset($s['o'], $s['z']) && is_array($s['o']) && count($s['o']) === 2 && is_numeric($s['o'][0]) && is_numeric($s['o'][1]) && is_numeric($s['z'])) {
        $z = (float) $s['z'];
        if ($z > 0 && is_finite($z) && abs((float) $s['o'][0]) < 1e12 && abs((float) $s['o'][1]) < 1e12) {
            $r['o'] = [(float) sprintf('%.9g', (float) $s['o'][0]), (float) sprintf('%.9g', (float) $s['o'][1])];
            $r['z'] = (float) sprintf('%.8g', max(1e-9, min(1e9, $z)));
        }
    }
    return $r;
}

/** Drehung (Grad, im Uhrzeigersinn) für Bilder, Stempel und Textfelder */
function stroke_rot(array $s): array
{
    $r = fmod((float) ($s['r'] ?? 0), 360.0);
    if ($r < 0) {
        $r += 360.0;
    }
    return abs($r) > 0.01 ? ['r' => round($r, 2)] : [];
}

/** Verknüpfung zu einer Seite einer anderen PDF oder Notizseite */
function stroke_link(array $s): array
{
    return is_array($s['ln'] ?? null) && is_string($s['ln']['path'] ?? null) && $s['ln']['path'] !== '' && strlen($s['ln']['path']) <= 400 && !str_contains($s['ln']['path'], '..')
        ? ['ln' => ['path' => $s['ln']['path'], 'pg' => max(0, min(100000, (int) ($s['ln']['pg'] ?? 0)))]] : [];
}

function valid_stroke_inner(array $s): ?array
{
    $id = (string) ($s['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{6,40}$/', $id)) {
        return null;
    }
    $pts = $s['pts'] ?? null;
    $t = in_array($s['t'] ?? '', ['pen', 'hl', 'tx', 'sh', 'txt', 'img'], true) ? $s['t'] : 'pen';
    $min = ['pen' => 3, 'hl' => 3, 'tx' => 4, 'sh' => 4, 'txt' => 2, 'img' => 2][$t];
    if (!is_array($pts) || count($pts) < $min || count($pts) > 60000) {
        return null;
    }
    $clean = [];
    foreach ($pts as $n) {
        if (!is_int($n) && !is_float($n)) {
            return null;
        }
        $clean[] = round((float) $n, 2);
    }
    $c = preg_match('/^#[0-9A-Fa-f]{6}$/', (string) ($s['c'] ?? '')) ? (string) $s['c'] : '#1A1A1A';
    $p = max(0, min(100000, (int) ($s['p'] ?? 0)));
    if ($t === 'tx') {
        // Textmarkierung: Rechtecke als x,y,Breite,Höhe
        if (count($clean) % 4 !== 0) {
            return null;
        }
        $k = in_array($s['k'] ?? '', ['hl', 'ul', 'st'], true) ? $s['k'] : 'hl';
        return ['id' => $id, 'p' => $p, 't' => 'tx', 'k' => $k, 'c' => $c, 'pts' => $clean];
    }
    if ($t === 'img') {
        $src = (string) ($s['src'] ?? '');
        if (!preg_match('/^[a-f0-9]{40}\.(jpg|png|gif|webp)$/', $src)) {
            return null;
        }
        return [
            'id' => $id, 'p' => $p, 't' => 'img', 'c' => $c, 'pts' => array_slice($clean, 0, 2), 'src' => $src,
            'bw' => max(1.0, min(100000.0, (float) ($s['bw'] ?? 100))), 'bh' => max(1.0, min(100000.0, (float) ($s['bh'] ?? 100))),
        ] + stroke_rot($s) + stroke_link($s);
    }
    if ($t === 'txt') {
        $text = mb_substr((string) ($s['text'] ?? ''), 0, 20000);
        if (trim($text) === '') {
            return null;
        }
        return [
            'id' => $id, 'p' => $p, 't' => 'txt', 'c' => $c, 'pts' => array_slice($clean, 0, 2), 'text' => $text,
            'fs' => max(4.0, min(120.0, (float) ($s['fs'] ?? 14))),
            'bw' => max(0.0, min(20000.0, (float) ($s['bw'] ?? 10))), 'bh' => max(0.0, min(100000.0, (float) ($s['bh'] ?? 10))),
        ] + (!empty($s['b']) ? ['b' => 1] : []) + (!empty($s['i']) ? ['i' => 1] : []) + (!empty($s['nt']) ? ['nt' => 1] : []) + stroke_rot($s)
          + (preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($s['bg'] ?? '')) ? ['bg' => (string) $s['bg']] : [])
          + (preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($s['bo'] ?? '')) ? ['bo' => (string) $s['bo']] : [])
          + (in_array($s['ff'] ?? '', ['serif', 'mono'], true) ? ['ff' => $s['ff']] : [])
          + (in_array($s['mk'] ?? '', ['f', 'v'], true) ? ['mk' => $s['mk']] : [])
          + (in_array($s['al'] ?? '', ['c', 'r'], true) ? ['al' => $s['al']] : [])
          + (isset($s['w']) && (float) $s['w'] > 0 ? ['w' => max(1.0, min(20000.0, (float) $s['w']))] : [])
          + (isset($s['src']) && is_string($s['src']) && $s['src'] !== '' ? ['src' => mb_substr($s['src'], 0, 20000)] : [])
          + stroke_link($s);
    }
    if ($t === 'sh') {
        $k = in_array($s['k'] ?? '', ['line', 'arrow', 'rect', 'oval'], true) ? $s['k'] : 'line';
        $w = max(0.01, min(60.0, (float) ($s['w'] ?? 1.5)));
        return ['id' => $id, 'p' => $p, 't' => 'sh', 'k' => $k, 'c' => $c, 'w' => $w, 'pts' => array_slice($clean, 0, 4)];
    }
    $w = max(0.01, min(60.0, (float) ($s['w'] ?? 1.5)));
    return ['id' => $id, 'p' => $p, 't' => $t, 'c' => $c, 'w' => $w, 'pts' => $clean];
}

/** Applies additions and deletions under an exclusive lock and returns the merged document. */
function merge_notes(string $rel, array $add, array $del): array
{
    $file = notes_file($rel);
    $fh = fopen($file, 'c+');
    if (!$fh) {
        fail('Notizen konnten nicht gespeichert werden.', 500);
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $doc = $raw ? json_decode($raw, true) : null;
    if (!is_array($doc)) {
        $doc = ['v' => 1, 'path' => $rel, 'rev' => 0, 'strokes' => [], 'deleted' => []];
    }
    $doc['strokes'] = (array) ($doc['strokes'] ?? []);
    $doc['deleted'] = (array) ($doc['deleted'] ?? []);
    $now = time();
    foreach ($del as $id) {
        $id = (string) $id;
        if (!preg_match('/^[A-Za-z0-9_-]{6,40}$/', $id)) {
            continue;
        }
        unset($doc['strokes'][$id]);
        $doc['deleted'][$id] = $now;
    }
    foreach ($add as $s) {
        $s = valid_stroke($s);
        if ($s && !isset($doc['deleted'][$s['id']])) {
            $doc['strokes'][$s['id']] = $s;
        }
    }
    $doc['rev'] = (int) ($doc['rev'] ?? 0) + 1;
    $doc['path'] = $rel;
    $json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, $json);
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    $doc['strokes'] = $doc['strokes'] ?: new stdClass();
    $doc['deleted'] = $doc['deleted'] ?: new stdClass();
    return $doc;
}

function api_token(): string
{
    $f = storage() . '/token.txt';
    return is_file($f) ? trim((string) file_get_contents($f)) : '';
}

/** Dreht einen Punkt um 90° im Uhrzeigersinn (alte Seitenhöhe $h). */
function rot_pt(float $x, float $y, float $h): array
{
    return [round($h - $y, 2), round($x, 2)];
}

function rotate_stroke(array $s, float $w, float $h): array
{
    $p = $s['pts'];
    if ($s['t'] === 'tx') {
        for ($i = 0; $i + 3 < count($p); $i += 4) {
            [$x, $y, $rw, $rh] = [$p[$i], $p[$i + 1], $p[$i + 2], $p[$i + 3]];
            [$p[$i], $p[$i + 1], $p[$i + 2], $p[$i + 3]] = [round($h - $y - $rh, 2), round($x, 2), $rh, $rw];
        }
    } elseif ($s['t'] === 'txt') {
        [$p[0], $p[1]] = [round($h - $p[1] - (float) ($s['bh'] ?? 0), 2), round($p[0], 2)];
    } elseif ($s['t'] === 'sh') {
        [$p[0], $p[1]] = rot_pt($p[0], $p[1], $h);
        [$p[2], $p[3]] = rot_pt($p[2], $p[3], $h);
    } else {
        for ($i = 0; $i + 1 < count($p); $i += 3) {
            [$p[$i], $p[$i + 1]] = rot_pt($p[$i], $p[$i + 1], $h);
        }
    }
    $s['pts'] = $p;
    return $s;
}

/** Seiten wurden umsortiert/gelöscht/gedreht: Seitennummern (und ggf. Koordinaten) der Notizen anpassen. */
function remap_notes(string $rel, array $map, array $rot): void
{
    $file = notes_file($rel);
    if (!is_file($file)) {
        return;
    }
    $fh = fopen($file, 'c+');
    flock($fh, LOCK_EX);
    $doc = json_decode((string) stream_get_contents($fh), true);
    if (is_array($doc)) {
        $out = [];
        $now = time();
        foreach ((array) ($doc['strokes'] ?? []) as $id => $st) {
            $old = (int) ($st['p'] ?? 0);
            $new = array_key_exists($old, $map) ? (int) $map[$old] : $old;
            if ($new < 0) {
                $doc['deleted'][$id] = $now;
                continue;
            }
            $st['p'] = $new;
            if (isset($rot[(string) $new]) && is_array($rot[(string) $new])) {
                $st = rotate_stroke($st, (float) ($rot[(string) $new]['w'] ?? 0), (float) ($rot[(string) $new]['h'] ?? 0));
            }
            $out[$id] = $st;
        }
        $doc['strokes'] = $out ?: new stdClass();
        $doc['rev'] = (int) ($doc['rev'] ?? 0) + 1;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    flock($fh, LOCK_UN);
    fclose($fh);
}

function thumb_file(string $rel, int $mtime): string
{
    return storage('thumbs') . '/' . sha1($rel) . '-' . $mtime . '.jpg';
}

function list_pdfs(): array
{
    $base = storage('pdfs');
    $files = [];
    $folders = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    $it->setMaxDepth(6);
    foreach ($it as $f) {
        $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($base))), '/');
        if (preg_match('#(^|/)\.#', $rel)) {
            continue;
        }
        if ($f->isDir()) {
            $folders[] = $rel;
            continue;
        }
        if (!preg_match('/\.pdf$/i', $rel)) {
            continue;
        }
        $nf = notes_file($rel);
        $mt = $f->getMTime();
        $folder = str_contains($rel, '/') ? dirname($rel) : '';
        $files[] = [
            'path'   => $rel,
            'folder' => $folder,
            'name'   => basename($rel),
            'size'   => $f->getSize(),
            'mtime'  => $f->getMTime(),
            'notesMtime' => is_file($nf) ? filemtime($nf) : 0,
            'thumb'  => is_file(thumb_file($rel, $mt)),
        ];
    }
    sort($folders, SORT_NATURAL | SORT_FLAG_CASE);
    usort($files, fn($a, $b) => strnatcasecmp($a['path'], $b['path']));
    return ['folders' => $folders, 'files' => $files];
}

/** Fingerabdruck einer PDF-Fassung: SHA-256 über die ersten 64 KB und das letzte MB (wie im Browser) */
function pdf_fp(string $file): string
{
    clearstatcache(true, $file);
    $n = (int) filesize($file);
    $h = fopen($file, 'rb');
    $a = (string) fread($h, max(1, min(65536, $n)));
    fseek($h, max(0, $n - 1048576));
    $b = (string) stream_get_contents($h);
    fclose($h);
    return hash('sha256', $a . $b);
}

/**
 * Neue Fassung einer PDF übernehmen – entweder komplett ($_FILES['pdf']) oder nur der angehängte Teil ($_FILES['tail']),
 * der an die bisherige Datei gehängt wird (inkrementelles Speichern: lädt bei großen PDFs nur wenige KB hoch).
 * Die bisherige Fassung wandert in storage/backup (die letzten 5 je PDF bleiben).
 */
function pdf_take_upload(string $rel, string $file, string $tooBig = ''): void
{
    $up = $_FILES['pdf'] ?? null;
    $tail = $_FILES['tail'] ?? null;
    $u = $up ?: $tail;
    if (!$u && isset($_POST['cut']) && is_file($file)) {
        // „Rückgängig“ nach angehängtem Speichern: den Anhang wieder abschneiden
        clearstatcache();
        $cut = (int) $_POST['cut'];
        if ((int) ($_POST['baseLen'] ?? -1) !== filesize($file) || !hash_equals(pdf_fp($file), (string) ($_POST['baseFp'] ?? '')) || $cut < 100 || $cut >= filesize($file)) {
            fail('Die PDF auf dem Server weicht ab – es wird die ganze Datei geschickt.', 409);
        }
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $in = fopen($file, 'rb');
        $out = fopen($tmp, 'wb');
        $n = ($in && $out) ? stream_copy_to_stream($in, $out, $cut) : false;
        $in && fclose($in);
        $out && fclose($out);
        if ($n !== $cut || !str_contains((string) file_get_contents($tmp, false, null, max(0, $cut - 64)), '%%EOF')) {
            @unlink($tmp);
            fail('Die PDF auf dem Server weicht ab – es wird die ganze Datei geschickt.', 409);
        }
        pdf_swap($rel, $file, $tmp);
        return;
    }
    if (($u && in_array($u['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) || (!$u && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0)) {
        fail('Die PDF ist größer, als der Server annimmt (upload_max_filesize ' . ini_get('upload_max_filesize') . ', post_max_size ' . ini_get('post_max_size') . ').' . $tooBig . ' Bitte in den PHP-Einstellungen des Hosters höher stellen (z. B. 200M).', 413);
    }
    if (!is_file($file) || !$u || $u['error'] !== UPLOAD_ERR_OK) {
        fail('Datei fehlt.', 400);
    }
    clearstatcache();
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if ($tail && !$up) {
        $baseLen = (int) ($_POST['baseLen'] ?? $_POST['baseSize'] ?? -1);
        if ($baseLen !== filesize($file) || !hash_equals(pdf_fp($file), (string) ($_POST['baseFp'] ?? ''))) {
            fail('Die PDF auf dem Server weicht ab – es wird die ganze Datei geschickt.', 409);
        }
        $t = (string) file_get_contents($tail['tmp_name'], false, null, max(0, filesize($tail['tmp_name']) - 64));
        if (!str_contains($t, '%%EOF')) {
            fail('Ungültiger Anhang.');
        }
        if (!copy($file, $tmp)) {
            fail('PDF konnte nicht gespeichert werden.', 500);
        }
        $in = fopen($tail['tmp_name'], 'rb');
        $out = fopen($tmp, 'ab');
        $ok = $in && $out && stream_copy_to_stream($in, $out) !== false;
        $in && fclose($in);
        $out && fclose($out);
        if (!$ok) {
            @unlink($tmp);
            fail('PDF konnte nicht gespeichert werden.', 500);
        }
    } else {
        if ((string) file_get_contents($up['tmp_name'], false, null, 0, 5) !== '%PDF-') {
            fail('Ungültiges PDF.');
        }
        if (!move_uploaded_file($up['tmp_name'], $tmp)) {
            fail('PDF konnte nicht gespeichert werden.', 500);
        }
    }
    pdf_swap($rel, $file, $tmp);
}

/** fertige neue Fassung ($tmp) an die Stelle von $file setzen, alte in die Sicherung */
function pdf_swap(string $rel, string $file, string $tmp): void
{
    // alte Fassung sichern (umbenennen statt kopieren – geht auch bei 200 MB sofort), neue an ihre Stelle
    $bdir = storage('backup');
    $bak = $bdir . '/' . sha1($rel) . '-' . date('Ymd-His') . '-' . preg_replace('/[^\w.-]/', '_', basename($rel));
    if (!@rename($file, $bak)) {
        @copy($file, $bak);
    }
    if (!@rename($tmp, $file)) {
        @rename($bak, $file);
        @unlink($tmp);
        fail('PDF konnte nicht gespeichert werden.', 500);
    }
    $old = glob($bdir . '/' . sha1($rel) . '-*') ?: [];
    sort($old);
    $pf = storage() . '/prefs.json';
    $keep = 5;
    if (is_file($pf)) {
        $pp = json_decode((string) file_get_contents($pf), true);
        if (isset($pp['settings']['keepVersions'])) {
            $keep = max(0, min(10, (int) $pp['settings']['keepVersions']));
        }
    }
    while (count($old) > $keep) {
        @unlink(array_shift($old));
    }
    clearstatcache();
    foreach (glob(storage('thumbs') . '/' . sha1($rel) . '-*.jpg') ?: [] as $th) {
        @unlink($th);
    }
}

/** Tonaufnahmen: Verzeichnis PDF-Pfad => Liste der Aufnahmen */
function audio_index_file(): string
{
    return storage('audio') . '/index.json';
}
function audio_list(string $rel): array
{
    $f = audio_index_file();
    $ix = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
    $out = [];
    foreach ($ix[$rel] ?? [] as $r) {
        $file = storage('audio') . '/' . ($r['id'] ?? '') . '.m4a';
        if (is_file($file)) {
            $out[] = $r + ['size' => filesize($file)];
        }
    }
    return $out;
}
function audio_index_update(callable $fn): void
{
    $f = audio_index_file();
    $h = fopen($f, 'c+');
    if (!$h) {
        fail('Aufnahmen-Verzeichnis nicht beschreibbar.', 500);
    }
    flock($h, LOCK_EX);
    $ix = json_decode((string) stream_get_contents($h), true) ?: [];
    $ix = $fn($ix);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($ix, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    flock($h, LOCK_UN);
    fclose($h);
}


/** Nutzungsbericht zum Hineinkopieren in den Chat: Werkzeuge, Fehler, Dauer (Markdown) */
function usage_report(int $days): string
{
    $since = time() - $days * 86400;
    $ev = [];
    foreach (glob(storage('usage') . '/*.jsonl') ?: [] as $f) {
        foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) {
            $e = json_decode($l, true);
            if (is_array($e) && ($e['t'] ?? 0) >= $since) {
                $ev[] = $e;
            }
        }
    }
    $fmt = fn ($ms) => $ms >= 60000 ? round($ms / 60000, 1) . ' min' : ($ms >= 1000 ? round($ms / 1000, 1) . ' s' : $ms . ' ms');
    $out = "# PDF-Stift – Nutzungsbericht\n";
    $out .= 'Zeitraum: letzte ' . $days . ' Tage (bis ' . date('d.m.Y H:i') . '), Server ' . PDFSTIFT_VERSION . ', ' . count($ev) . " Einträge\n";
    $devs = [];
    foreach ($ev as $e) {
        $devs[$e['d'] ?? '?'][$e['v'] ?? '?'] = true;
    }
    foreach ($devs as $d => $vs) {
        $out .= '- Gerät ' . ($d ?: '?') . ': Version ' . implode(', ', array_keys($vs)) . "\n";
    }
    // Werkzeuge
    $tools = [];
    foreach ($ev as $e) {
        if ($e['k'] === 'tool') {
            $tools[$e['n']][$e['d'] ?? '?'] = ($tools[$e['n']][$e['d'] ?? '?'] ?? 0) + 1;
        }
    }
    uasort($tools, fn ($a, $b) => array_sum($b) <=> array_sum($a));
    $out .= "\n## Benutzte Werkzeuge (Anzahl)\n";
    foreach ($tools as $n => $by) {
        $out .= '- ' . $n . ': ' . array_sum($by) . ' (' . implode(', ', array_map(fn ($d, $c) => "$d $c", array_keys($by), $by)) . ")\n";
    }
    $known = ['PDF erstellen', 'Zusammenfügen', 'Seiten organisieren', 'Seiten herausziehen/aufteilen', 'Text bearbeiten', 'Bilder bearbeiten', 'Exportieren', 'Texterkennung (von Hand)', 'Texterkennung automatisch', 'Scans aufbereiten', 'Handzettel', 'Kopf-/Fußzeile & Wasserzeichen', 'Lesezeichen', 'Kommentieren', 'Kommentar angelegt', 'Kommentarliste', 'Stempel', 'Vergleichen', 'Ausfüllen & Unterschreiben', 'Formular vorbereiten', 'Mit Passwort schützen', 'Schwärzen', 'Suchen & Schwärzen', 'Zwei Seiten', 'Ansicht drehen', 'Drucken', 'Präsentation', 'Live-Mitschau', 'Suche in der PDF', 'Hochladen', 'Hineingezogen', 'Office → PDF (Windows)', 'Drucker PDF-Stift', 'Senden an / Öffnen mit', 'Tonaufnahme'];
    $unused = array_values(array_filter($known, fn ($k) => !isset($tools[$k])));
    if ($unused) {
        $out .= "\nNicht benutzt: " . implode(', ', $unused) . "\n";
    }
    // Dauer
    $perf = [];
    foreach ($ev as $e) {
        if ($e['k'] === 'perf' && isset($e['ms'])) {
            $perf[$e['n']][] = $e;
        }
    }
    ksort($perf);
    $out .= "\n## Dauer\n";
    foreach ($perf as $n => $list) {
        usort($list, fn ($a, $b) => $a['ms'] <=> $b['ms']);
        $c = count($list);
        $med = $list[intdiv($c, 2)]['ms'];
        $p90 = $list[min($c - 1, (int) floor($c * 0.9))]['ms'];
        $max = $list[$c - 1];
        $out .= "- $n: {$c}×, Median " . $fmt($med) . ', 90 % unter ' . $fmt($p90) . ', längste ' . $fmt($max['ms']) . (isset($max['x']) ? ' (' . $max['x'] . ')' : '') . ' [' . ($max['d'] ?? '?') . "]\n";
    }
    // Fehler
    $errs = [];
    foreach ($ev as $e) {
        if ($e['k'] === 'err') {
            $key = preg_replace('/\d+/', '#', $e['n']);
            $errs[$key] = $errs[$key] ?? ['n' => 0, 'last' => 0, 'd' => [], 'x' => '', 'v' => ''];
            $errs[$key]['n']++;
            $errs[$key]['d'][$e['d'] ?? '?'] = true;
            if ($e['t'] >= $errs[$key]['last']) {
                $errs[$key]['last'] = $e['t'];
                $errs[$key]['x'] = $e['x'] ?? '';
                $errs[$key]['v'] = $e['v'] ?? '';
            }
        }
    }
    uasort($errs, fn ($a, $b) => $b['n'] <=> $a['n']);
    $out .= "\n## Fehler\n" . ($errs ? '' : "- keine\n");
    foreach (array_slice($errs, 0, 40, true) as $k => $r) {
        $out .= "- {$r['n']}× $k – zuletzt " . date('d.m. H:i', $r['last']) . ' [' . implode(', ', array_keys($r['d'])) . ' ' . $r['v'] . ']' . ($r['x'] !== '' ? "\n  " . $r['x'] : '') . "\n";
    }
    // Meldungen der Tablet-App (Absturzberichte, „Fehler melden“) – Dateinamen unkenntlich
    $lf = storage() . '/applog.txt';
    if (is_file($lf)) {
        $txt = (string) file_get_contents($lf, false, null, max(0, filesize($lf) - 400000));
        $parts = preg_split('/^==== /m', $txt);
        $rows = [];
        foreach ($parts as $p) {
            if (!preg_match('/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/', $p, $m) || strtotime($m[1]) < $since) {
                continue;
            }
            $lines = array_values(array_filter(array_map('trim', explode("\n", $p))));
            $body = implode(' | ', array_slice($lines, 1, 4));
            $body = preg_replace('/[^\s\/|„"]*\.pdf/iu', '[Datei]', $body);
            $rows[] = '- ' . $m[1] . ': ' . substr($body, 0, 400);
        }
        $out .= "\n## Meldungen der Tablet-App (" . count($rows) . ")\n" . ($rows ? implode("\n", array_slice($rows, -25)) . "\n" : "- keine\n");
    }
    return $out;
}
