<?php
declare(strict_types=1);

/*
 * Nextcloud-Anbindung: PDFs aus einem Nextcloud-Ordner werden per WebDAV nach storage/pdfs übernommen.
 * Richtung: nur Nextcloud → PDF-Stift. In Nextcloud gelöschte Dateien bleiben in PDF-Stift erhalten.
 */

function nc_file(): string
{
    return storage() . '/nextcloud.json';
}

function nc_cfg(): array
{
    $f = nc_file();
    $c = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    return is_array($c) ? $c : [];
}

function nc_save(array $c): void
{
    file_put_contents(nc_file(), json_encode($c, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function nc_public(array $c): array
{
    return [
        'configured' => !empty($c['url']) && !empty($c['user']) && !empty($c['pass']),
        'url'        => $c['url'] ?? '',
        'user'       => $c['user'] ?? '',
        'folder'     => $c['folder'] ?? 'PDF-Stift',
        'last'       => (int) ($c['last'] ?? 0),
        'lastError'  => $c['lastError'] ?? '',
        'count'      => count($c['etags'] ?? []),
        'export'     => !empty($c['export']),
    ];
}

function nc_enc_path(string $path): string
{
    return implode('/', array_map('rawurlencode', array_filter(explode('/', $path), fn($s) => $s !== '')));
}

function nc_base(array $c): string
{
    $folder = nc_enc_path((string) ($c['folder'] ?? ''));
    return rtrim((string) $c['url'], '/') . '/remote.php/dav/files/' . rawurlencode((string) $c['user']) . '/' . ($folder !== '' ? $folder . '/' : '');
}

/** HTTP-Anfrage an Nextcloud. Mit $sink wird der Inhalt direkt in diese Datei geschrieben. */
function nc_http(array $c, string $method, string $url, array $headers = [], ?string $body = null, ?string $sink = null): array
{
    $auth = 'Authorization: Basic ' . base64_encode($c['user'] . ':' . $c['pass']);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $fh = null;
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => array_merge([$auth], $headers),
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 120,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        if ($sink !== null) {
            $fh = fopen($sink, 'wb');
            curl_setopt($ch, CURLOPT_FILE, $fh);
        } else {
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        }
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($fh) {
            fclose($fh);
        }
        if ($res === false) {
            return [0, '', $err ?: 'Keine Verbindung'];
        }
        return [$code, $sink === null ? (string) $res : '', ''];
    }
    // Ohne cURL: PHP-Streams
    $ctx = stream_context_create(['http' => [
        'method' => $method, 'header' => implode("\r\n", array_merge([$auth], $headers)),
        'content' => $body ?? '', 'ignore_errors' => true, 'timeout' => 120, 'follow_location' => 1,
    ]]);
    $in = @fopen($url, 'rb', false, $ctx);
    if (!$in) {
        return [0, '', 'Keine Verbindung'];
    }
    $meta = stream_get_meta_data($in);
    $code = 0;
    foreach (($meta['wrapper_data'] ?? []) as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    if ($sink !== null) {
        $out = fopen($sink, 'wb');
        stream_copy_to_stream($in, $out);
        fclose($out);
        $data = '';
    } else {
        $data = (string) stream_get_contents($in);
    }
    fclose($in);
    return [$code, $data, ''];
}

/** Listet einen Ordner (Tiefe 1). Liefert [Einträge, Fehler]. */
function nc_list(array $c, string $rel): array
{
    $url = nc_base($c) . ($rel !== '' ? nc_enc_path($rel) . '/' : '');
    $xml = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>';
    [$code, $body, $err] = nc_http($c, 'PROPFIND', $url, ['Depth: 1', 'Content-Type: application/xml; charset=utf-8'], $xml);
    if ($code === 401) {
        return [[], 'Anmeldung bei Nextcloud fehlgeschlagen. Benutzername und App-Passwort prüfen.'];
    }
    if ($code === 404) {
        return [[], 'Den Ordner „' . ($c['folder'] ?? '') . ($rel ? '/' . $rel : '') . '“ gibt es in Nextcloud nicht.'];
    }
    if ($code !== 207) {
        return [[], $err ?: 'Nextcloud antwortet nicht wie erwartet (HTTP ' . $code . '). Stimmt die Adresse?'];
    }
    $dom = new DOMDocument();
    if (!@$dom->loadXML($body)) {
        return [[], 'Antwort von Nextcloud nicht lesbar.'];
    }
    $xp = new DOMXPath($dom);
    $xp->registerNamespace('d', 'DAV:');
    $basePath = rawurldecode((string) parse_url($url, PHP_URL_PATH));
    $out = [];
    foreach ($xp->query('//d:response') as $r) {
        $href = rawurldecode((string) $xp->evaluate('string(d:href)', $r));
        $hrefPath = rawurldecode((string) (parse_url($href, PHP_URL_PATH) ?? $href));
        if (rtrim($hrefPath, '/') === rtrim($basePath, '/')) {
            continue; // der Ordner selbst
        }
        $name = basename(rtrim($hrefPath, '/'));
        $isDir = $xp->query('.//d:resourcetype/d:collection', $r)->length > 0;
        $out[] = [
            'rel'   => ltrim(($rel !== '' ? $rel . '/' : '') . $name, '/'),
            'dir'   => $isDir,
            'size'  => (int) $xp->evaluate('string(.//d:getcontentlength)', $r),
            'etag'  => trim((string) $xp->evaluate('string(.//d:getetag)', $r), '"'),
            'mtime' => strtotime((string) $xp->evaluate('string(.//d:getlastmodified)', $r)) ?: time(),
        ];
    }
    return [$out, ''];
}

/** Gleicht ab, solange das Zeitbudget reicht. */
function nc_sync(int $budget = 40): array
{
    @set_time_limit($budget + 60);
    $c = nc_cfg();
    if (empty($c['url']) || empty($c['user']) || empty($c['pass'])) {
        return ['ok' => false, 'error' => 'Nextcloud ist nicht eingerichtet.'];
    }
    $lock = fopen(storage() . '/nextcloud.lock', 'c');
    if (!flock($lock, LOCK_EX | LOCK_NB)) {
        return ['ok' => true, 'busy' => true, 'imported' => [], 'pending' => true];
    }
    $start = time();
    $etags = (array) ($c['etags'] ?? []);
    $imported = [];
    $pending = false;
    $error = '';
    $queue = [''];
    $depth = [0];
    $tmpDir = storage('tmp');
    while ($queue) {
        $rel = array_shift($queue);
        $d = array_shift($depth);
        [$items, $listErr] = nc_list($c, $rel);
        if ($listErr !== '') {
            $error = $listErr;
            break;
        }
        foreach ($items as $it) {
            if ($it['dir']) {
                // „Mit Notizen“ füllt PDF-Stift selbst – nicht wieder einlesen
                if ($rel === '' && mb_strtolower($it['rel']) === 'mit notizen') {
                    continue;
                }
                if ($d < 5 && $it['rel'][0] !== '.') {
                    $queue[] = $it['rel'];
                    $depth[] = $d + 1;
                }
                continue;
            }
            if (!preg_match('/\.pdf$/i', $it['rel']) || preg_match('#(^|/)\.#', $it['rel'])) {
                continue;
            }
            $target = storage('pdfs') . '/' . $it['rel'];
            if (($etags[$it['rel']] ?? '') === $it['etag'] && is_file($target)) {
                continue;
            }
            if (time() - $start > $budget) {
                $pending = true;
                continue;
            }
            $fe = nc_fetch_file($c, $it);
            if ($fe !== '') {
                $error = $fe;
                continue;
            }
            $etags[$it['rel']] = $it['etag'];
            $imported[] = $it['rel'];
        }
    }
    $c = nc_cfg(); // könnte inzwischen geändert worden sein
    $c['etags'] = $etags;
    $c['last'] = time();
    $c['lastError'] = $error;
    nc_save($c);
    flock($lock, LOCK_UN);
    fclose($lock);
    return ['ok' => $error === '', 'error' => $error, 'imported' => $imported, 'pending' => $pending];
}

/** Legt die beschriftete PDF unter „<Ordner>/Mit Notizen/<Pfad>“ in Nextcloud ab. */
function nc_put_annotated(string $rel, string $bin): string
{
    $c = nc_cfg();
    if (empty($c['url']) || empty($c['user']) || empty($c['pass'])) {
        return 'Nextcloud ist nicht eingerichtet.';
    }
    $target = 'Mit Notizen/' . $rel;
    $dirs = explode('/', $target);
    array_pop($dirs);
    $acc = '';
    foreach ($dirs as $seg) {
        $acc = ltrim($acc . '/' . $seg, '/');
        [$code] = nc_http($c, 'MKCOL', nc_base($c) . nc_enc_path($acc) . '/');
        if (!in_array($code, [201, 405], true)) {
            return 'Ordner in Nextcloud konnte nicht angelegt werden (HTTP ' . $code . ').';
        }
    }
    [$code, , $err] = nc_http($c, 'PUT', nc_base($c) . nc_enc_path($target), ['Content-Type: application/pdf'], $bin);
    if (!in_array($code, [200, 201, 204], true)) {
        return 'Hochladen nach Nextcloud fehlgeschlagen (' . ($err ?: 'HTTP ' . $code) . ').';
    }
    return '';
}

/** Lädt eine PDF aus Nextcloud nach storage/pdfs (gleicher relativer Pfad). Leer = ok, sonst Fehlermeldung. */
function nc_fetch_file(array $c, array $it): string
{
    $target = storage('pdfs') . '/' . $it['rel'];
    $tmp = storage('tmp') . '/' . bin2hex(random_bytes(8)) . '.part';
    [$code, , $err] = nc_http($c, 'GET', nc_base($c) . nc_enc_path($it['rel']), [], null, $tmp);
    $head = is_file($tmp) ? (string) file_get_contents($tmp, false, null, 0, 5) : '';
    if ($code !== 200 || $head !== '%PDF-') {
        @unlink($tmp);
        return 'Datei „' . $it['rel'] . '“ konnte nicht geladen werden (' . ($err ?: 'HTTP ' . $code) . ').';
    }
    if (!is_dir(dirname($target))) {
        mkdir(dirname($target), 0775, true);
    }
    rename($tmp, $target);
    @touch($target, (int) $it['mtime']);
    return '';
}

function nc_set_etag(string $rel, string $etag): void
{
    $c = nc_cfg();
    $c['etags'][$rel] = $etag;
    nc_save($c);
}

/** Ordnerinhalt live aus Nextcloud, ergänzt um den Stand in PDF-Stift. */
function nc_browse(string $rel): array
{
    $c = nc_cfg();
    if (empty($c['url'])) {
        return ['error' => 'Nextcloud ist nicht eingerichtet.'];
    }
    [$items, $err] = nc_list($c, $rel);
    if ($err !== '') {
        return ['error' => $err];
    }
    $etags = (array) ($c['etags'] ?? []);
    $folders = [];
    $files = [];
    foreach ($items as $it) {
        $name = basename($it['rel']);
        if ($name === '' || $name[0] === '.') {
            continue;
        }
        if ($it['dir']) {
            if ($rel === '' && mb_strtolower($name) === 'mit notizen') {
                continue;
            }
            $folders[] = ['path' => $it['rel'], 'name' => $name];
            continue;
        }
        if (!preg_match('/\.pdf$/i', $name)) {
            continue;
        }
        $local = storage('pdfs') . '/' . $it['rel'];
        $have = is_file($local);
        $state = !$have ? 'cloud' : (($etags[$it['rel']] ?? '') === $it['etag'] ? 'ok' : 'update');
        $files[] = ['path' => $it['rel'], 'name' => $name, 'size' => $it['size'], 'mtime' => $it['mtime'], 'etag' => $it['etag'], 'state' => $state];
    }
    usort($folders, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
    usort($files, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
    return ['path' => $rel, 'root' => (string) ($c['folder'] ?? ''), 'folders' => $folders, 'files' => $files];
}

/** Holt eine einzelne PDF (für „direkt aus Nextcloud öffnen“). */
function nc_fetch_one(string $rel): string
{
    $c = nc_cfg();
    if (empty($c['url'])) {
        return 'Nextcloud ist nicht eingerichtet.';
    }
    $parent = str_contains($rel, '/') ? dirname($rel) : '';
    [$items, $err] = nc_list($c, $parent);
    if ($err !== '') {
        return $err;
    }
    foreach ($items as $it) {
        if (!$it['dir'] && $it['rel'] === $rel) {
            $fe = nc_fetch_file($c, $it);
            if ($fe === '') {
                nc_set_etag($rel, $it['etag']);
            }
            return $fe;
        }
    }
    return 'Die Datei gibt es in Nextcloud nicht mehr.';
}

/** Legt einen Ordner in Nextcloud an (mit allen Zwischenordnern). */
function nc_mkdir(string $rel): string
{
    $c = nc_cfg();
    $acc = '';
    foreach (explode('/', $rel) as $seg) {
        $acc = ltrim($acc . '/' . $seg, '/');
        [$code, , $err] = nc_http($c, 'MKCOL', nc_base($c) . nc_enc_path($acc) . '/');
        if (!in_array($code, [201, 405], true)) {
            return 'Ordner konnte in Nextcloud nicht angelegt werden (' . ($err ?: 'HTTP ' . $code) . ').';
        }
    }
    return '';
}

/** Lädt eine Datei nach Nextcloud hoch und übernimmt sie gleich in PDF-Stift. */
function nc_upload_file(string $folder, string $name, string $tmpFile): string
{
    $c = nc_cfg();
    if ($folder !== '' && ($e = nc_mkdir($folder)) !== '') {
        return $e;
    }
    $rel = ltrim(($folder !== '' ? $folder . '/' : '') . $name, '/');
    [$code, , $err] = nc_http($c, 'PUT', nc_base($c) . nc_enc_path($rel), ['Content-Type: application/pdf'], (string) file_get_contents($tmpFile));
    if (!in_array($code, [200, 201, 204], true)) {
        return 'Hochladen nach Nextcloud fehlgeschlagen (' . ($err ?: 'HTTP ' . $code) . ').';
    }
    return nc_fetch_one($rel);
}
