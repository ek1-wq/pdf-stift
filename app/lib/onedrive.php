<?php
declare(strict_types=1);

/*
 * OneDrive über Microsoft Graph. Anmeldung per Gerätecode („Code auf microsoft.com/devicelogin eingeben“),
 * dafür braucht es nur eine kostenlose App-Registrierung (Anwendungs-ID) – kein Geheimnis, keine Weiterleitungsadresse.
 * PDFs aus OneDrive landen in PDF-Stift unter „OneDrive/…“. Word/PowerPoint werden dabei von Microsoft in PDF umgewandelt.
 */

const OD_SCOPE = 'Files.ReadWrite Notes.Read offline_access User.Read';
const OD_SCOPE_OLD = 'Files.ReadWrite offline_access User.Read'; // Anmeldungen vor Version 1.12 (ohne OneNote)
const OD_OFFICE = ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'xls', 'xlsx', 'ods'];

function od_file(): string { return storage() . '/onedrive.json'; }

function od_cfg(): array
{
    $f = od_file();
    $c = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    return is_array($c) ? $c : [];
}

function od_save(array $c): void
{
    file_put_contents(od_file(), json_encode($c, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function od_public(array $c): array
{
    return [
        'clientId'  => $c['client_id'] ?? '',
        'connected' => !empty($c['refresh_token']),
        'onenote'   => !empty($c['refresh_token']) && str_contains((string) ($c['scope'] ?? ''), 'Notes.Read'),
        'user'      => $c['user'] ?? '',
        'folder'    => $c['folder'] ?? '',
        'tenant'    => $c['tenant'] ?? 'common',
    ];
}

/** Einfache HTTP-Anfrage (cURL), folgt KEINEN Weiterleitungen – Download-Links liefert Graph per 302. */
function od_http(string $method, string $url, array $headers = [], ?string $body = null, ?string $sink = null): array
{
    $ch = curl_init($url);
    $respHeaders = [];
    $fh = null;
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 300,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders) {
            $p = strpos($line, ':');
            if ($p !== false) {
                $respHeaders[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            }
            return strlen($line);
        },
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
    return [$code, $sink === null && is_string($res) ? $res : '', $respHeaders, $res === false ? ($err ?: 'Keine Verbindung') : ''];
}

function od_login_url(array $c, string $what): string
{
    return (getenv('PDFSTIFT_LOGIN') ?: 'https://login.microsoftonline.com') . '/' . rawurlencode($c['tenant'] ?? 'common') . '/oauth2/v2.0/' . $what;
}

/** Schritt 1 der Anmeldung: Gerätecode holen. */
function od_device_start(): array
{
    $c = od_cfg();
    if (empty($c['client_id'])) {
        return ['error' => 'Bitte zuerst die Anwendungs-ID eintragen.'];
    }
    [$code, $body, , $err] = od_http('POST', od_login_url($c, 'devicecode'), ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query(['client_id' => $c['client_id'], 'scope' => OD_SCOPE]));
    $j = json_decode($body, true) ?: [];
    if ($code !== 200 || empty($j['device_code'])) {
        return ['error' => od_explain($j, $err ?: 'HTTP ' . $code)];
    }
    $c['device_code'] = $j['device_code'];
    $c['device_until'] = time() + (int) ($j['expires_in'] ?? 900);
    od_save($c);
    return ['userCode' => $j['user_code'], 'url' => $j['verification_uri'] ?? 'https://microsoft.com/devicelogin', 'interval' => (int) ($j['interval'] ?? 5)];
}

/** Schritt 2: nachsehen, ob die Anmeldung bestätigt wurde. */
function od_device_poll(): array
{
    $c = od_cfg();
    if (empty($c['device_code'])) {
        return ['status' => 'error', 'error' => 'Keine Anmeldung gestartet.'];
    }
    if (time() > (int) ($c['device_until'] ?? 0)) {
        return ['status' => 'error', 'error' => 'Der Code ist abgelaufen. Bitte neu anmelden.'];
    }
    [$code, $body, , $err] = od_http('POST', od_login_url($c, 'token'), ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:device_code', 'client_id' => $c['client_id'], 'device_code' => $c['device_code'],
    ]));
    $j = json_decode($body, true) ?: [];
    if ($code === 200 && !empty($j['access_token'])) {
        unset($c['device_code'], $c['device_until']);
        $c['scope'] = OD_SCOPE;
        od_store_tokens($c, $j);
        [, $mb] = od_graph('GET', '/me?$select=displayName,userPrincipalName,mail');
        $me = json_decode($mb, true) ?: [];
        $c = od_cfg();
        $c['user'] = trim(($me['displayName'] ?? '') . ' ' . (($me['mail'] ?? $me['userPrincipalName'] ?? '') ? '(' . ($me['mail'] ?? $me['userPrincipalName']) . ')' : ''));
        od_save($c);
        return ['status' => 'ok', 'user' => $c['user']];
    }
    $e = $j['error'] ?? '';
    if ($e === 'authorization_pending' || $e === 'slow_down') {
        return ['status' => 'pending'];
    }
    return ['status' => 'error', 'error' => od_explain($j, $err ?: 'HTTP ' . $code)];
}

function od_explain(array $j, string $fallback): string
{
    $e = (string) ($j['error'] ?? '');
    $d = (string) ($j['error_description'] ?? '');
    if ($e === 'authorization_declined') return 'Die Anmeldung wurde abgelehnt.';
    if ($e === 'expired_token') return 'Der Code ist abgelaufen. Bitte neu anmelden.';
    if (str_contains($d, 'AADSTS7000218') || str_contains($d, 'AADSTS70002')) {
        return 'In der App-Registrierung muss „Öffentliche Clientflows zulassen“ auf „Ja“ stehen (Authentifizierung → Erweiterte Einstellungen).';
    }
    if (str_contains($d, 'AADSTS700016')) return 'Diese Anwendungs-ID ist Microsoft unbekannt. Bitte prüfen.';
    if (str_contains($d, 'AADSTS50020') || str_contains($d, 'AADSTS90072')) {
        return 'Dieses Konto passt nicht zur App-Registrierung. Bei „Unterstützte Kontotypen“ „Konten in allen Organisationsverzeichnissen und persönliche Microsoft-Konten“ wählen.';
    }
    if (str_contains($d, 'AADSTS65001') || str_contains($d, 'AADSTS90094')) {
        return 'Für dieses Konto muss die IT (Administrator) die App einmal freigeben.';
    }
    return $d !== '' ? preg_replace('/\s+Trace ID.*$/s', '', $d) : $fallback;
}

function od_store_tokens(array &$c, array $j): void
{
    $c['access_token'] = $j['access_token'];
    $c['expires'] = time() + (int) ($j['expires_in'] ?? 3600) - 120;
    if (!empty($j['refresh_token'])) {
        $c['refresh_token'] = $j['refresh_token'];
    }
    od_save($c);
}

/** Gültiges Zugriffstoken (erneuert es bei Bedarf). Leer = nicht angemeldet. */
function od_token(): string
{
    $c = od_cfg();
    if (empty($c['refresh_token'])) {
        return '';
    }
    if (!empty($c['access_token']) && time() < (int) ($c['expires'] ?? 0)) {
        return $c['access_token'];
    }
    [$code, $body] = od_http('POST', od_login_url($c, 'token'), ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'grant_type' => 'refresh_token', 'client_id' => $c['client_id'], 'refresh_token' => $c['refresh_token'], 'scope' => $c['scope'] ?? OD_SCOPE_OLD,
    ]));
    $j = json_decode($body, true) ?: [];
    if ($code !== 200 || empty($j['access_token'])) {
        if (in_array($j['error'] ?? '', ['invalid_grant', 'interaction_required'], true)) {
            unset($c['refresh_token'], $c['access_token']);
            od_save($c);
        }
        return '';
    }
    od_store_tokens($c, $j);
    return $j['access_token'];
}

function od_graph_base(): string
{
    return getenv('PDFSTIFT_GRAPH') ?: 'https://graph.microsoft.com/v1.0';
}

function od_graph(string $method, string $path, array $headers = [], ?string $body = null, ?string $sink = null): array
{
    $t = od_token();
    if ($t === '') {
        return [401, '', [], 'OneDrive ist nicht (mehr) angemeldet. Bitte in den OneDrive-Einstellungen neu anmelden.'];
    }
    $url = str_starts_with($path, 'http') ? $path : od_graph_base() . $path;
    return od_http($method, $url, array_merge(['Authorization: Bearer ' . $t], $headers), $body, $sink);
}

function od_enc(string $path): string
{
    return implode('/', array_map('rawurlencode', array_filter(explode('/', $path), fn($s) => $s !== '')));
}

/** Graph-Adresse für einen Pfad relativ zum gewählten Startordner. */
function od_item(string $rel, string $suffix = ''): string
{
    $full = trim(trim((string) (od_cfg()['folder'] ?? ''), '/') . '/' . $rel, '/');
    if ($full === '') {
        return '/me/drive/root' . ($suffix !== '' ? '/' . ltrim($suffix, ':/') : '');
    }
    return '/me/drive/root:/' . od_enc($full) . ':' . ($suffix !== '' ? '/' . ltrim($suffix, ':/') : '');
}

function od_err(int $code, string $body, string $err): string
{
    if ($err !== '') return $err;
    $j = json_decode($body, true) ?: [];
    $m = $j['error']['message'] ?? '';
    if ($code === 404) return 'Gibt es in OneDrive nicht (mehr).';
    return 'OneDrive: ' . ($m !== '' ? $m : 'HTTP ' . $code);
}

function od_ext(string $name): string
{
    return strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
}

/** Name in PDF-Stift: PDFs wie sie sind, Office-Dateien als „Name.pdf“ (bzw. „Name.pptx.pdf“, falls es eine gleichnamige PDF gibt). */
function od_local_rel(string $rel, array $siblingNames = []): string
{
    $ext = od_ext($rel);
    if ($ext === 'pdf') {
        return 'OneDrive/' . $rel;
    }
    $base = preg_replace('/\.[^.\/]+$/', '', $rel);
    $plain = basename($base) . '.pdf';
    $lower = array_map('mb_strtolower', $siblingNames);
    return 'OneDrive/' . (in_array(mb_strtolower($plain), $lower, true) ? $rel . '.pdf' : $base . '.pdf');
}

function od_children(string $rel): array
{
    $items = [];
    $next = od_item($rel, 'children') . '?$top=500&$select=name,folder,file,size,lastModifiedDateTime,cTag,eTag';
    while ($next) {
        [$code, $body, , $err] = od_graph('GET', $next);
        if ($code !== 200) {
            return [[], od_err($code, $body, $err)];
        }
        $j = json_decode($body, true) ?: [];
        foreach ($j['value'] ?? [] as $v) {
            $items[] = $v;
        }
        $next = $j['@odata.nextLink'] ?? '';
    }
    return [$items, ''];
}

function od_browse(string $rel): array
{
    [$items, $err] = od_children($rel);
    if ($err !== '') {
        return ['error' => $err];
    }
    $c = od_cfg();
    $tags = (array) ($c['tags'] ?? []);
    $names = array_map(fn($v) => (string) $v['name'], $items);
    $folders = [];
    $files = [];
    foreach ($items as $v) {
        $name = (string) $v['name'];
        if ($name === '' || $name[0] === '.' || $name === 'PDF-Stift-Umwandlung') {
            continue;
        }
        $path = ltrim(($rel !== '' ? $rel . '/' : '') . $name, '/');
        if (isset($v['folder'])) {
            $folders[] = ['path' => $path, 'name' => $name, 'count' => (int) ($v['folder']['childCount'] ?? 0)];
            continue;
        }
        $ext = od_ext($name);
        if ($ext !== 'pdf' && !in_array($ext, OD_OFFICE, true)) {
            continue;
        }
        $local = od_local_rel($path, $names);
        $tag = (string) ($v['cTag'] ?? $v['eTag'] ?? '');
        $have = is_file(storage('pdfs') . '/' . $local);
        $state = !$have ? 'cloud' : (($tags[$local] ?? '') === $tag ? 'ok' : 'update');
        $files[] = [
            'path' => $path, 'local' => $local, 'name' => $name, 'ext' => $ext, 'size' => (int) ($v['size'] ?? 0),
            'mtime' => strtotime((string) ($v['lastModifiedDateTime'] ?? '')) ?: time(), 'state' => $state,
        ];
    }
    usort($folders, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
    usort($files, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
    return ['path' => $rel, 'root' => (string) ($c['folder'] ?? ''), 'folders' => $folders, 'files' => $files];
}

/** Lädt eine Datei (ggf. als PDF umgewandelt) über einen 302-Download-Link. */
function od_download(string $graphPath, string $target): string
{
    [$code, $body, $h, $err] = od_graph('GET', $graphPath);
    if ($code === 302 && !empty($h['location'])) {
        $tmp = storage('tmp') . '/' . bin2hex(random_bytes(8)) . '.part';
        [$c2, , , $e2] = od_http('GET', $h['location'], [], null, $tmp);
        if ($c2 !== 200) {
            @unlink($tmp);
            return 'Download aus OneDrive fehlgeschlagen (' . ($e2 ?: 'HTTP ' . $c2) . ').';
        }
    } elseif ($code === 200) {
        $tmp = storage('tmp') . '/' . bin2hex(random_bytes(8)) . '.part';
        file_put_contents($tmp, $body);
    } else {
        if ($code === 406 || $code === 400) {
            return 'Microsoft konnte diese Datei nicht in PDF umwandeln.';
        }
        return od_err($code, $body, $err);
    }
    if ((string) file_get_contents($tmp, false, null, 0, 5) !== '%PDF-') {
        @unlink($tmp);
        return 'Aus OneDrive kam keine gültige PDF.';
    }
    if (!is_dir(dirname($target))) {
        mkdir(dirname($target), 0775, true);
    }
    rename($tmp, $target);
    return '';
}

/** Holt eine Datei aus OneDrive nach PDF-Stift. Gibt [lokaler Pfad, Fehler] zurück. */
function od_fetch(string $rel): array
{
    @set_time_limit(300);
    $parent = str_contains($rel, '/') ? dirname($rel) : '';
    [$items, $err] = od_children($parent);
    if ($err !== '') {
        return ['', $err];
    }
    $names = array_map(fn($v) => (string) $v['name'], $items);
    foreach ($items as $v) {
        if ($v['name'] !== basename($rel) || isset($v['folder'])) {
            continue;
        }
        $local = od_local_rel($rel, $names);
        $ext = od_ext($rel);
        $e = od_download(od_item($rel, 'content') . ($ext === 'pdf' ? '' : '?format=pdf'), storage('pdfs') . '/' . $local);
        if ($e !== '') {
            return ['', $e];
        }
        $mt = strtotime((string) ($v['lastModifiedDateTime'] ?? '')) ?: time();
        @touch(storage('pdfs') . '/' . $local, $mt);
        $c = od_cfg();
        $c['tags'][$local] = (string) ($v['cTag'] ?? $v['eTag'] ?? '');
        od_save($c);
        return [$local, ''];
    }
    return ['', 'Die Datei gibt es in OneDrive nicht mehr.'];
}

function od_mkdir(string $rel): string
{
    $acc = '';
    foreach (explode('/', $rel) as $seg) {
        $parent = $acc;
        $acc = ltrim($acc . '/' . $seg, '/');
        [$code, $body, , $err] = od_graph('POST', od_item($parent, 'children'), ['Content-Type: application/json'],
            json_encode(['name' => $seg, 'folder' => new stdClass(), '@microsoft.graph.conflictBehavior' => 'fail']));
        if (!in_array($code, [200, 201, 409], true)) {
            return od_err($code, $body, $err);
        }
    }
    return '';
}

function od_upload(string $folder, string $name, string $tmpFile): array
{
    if ($folder !== '' && ($e = od_mkdir($folder)) !== '') {
        return ['', $e];
    }
    $rel = ltrim(($folder !== '' ? $folder . '/' : '') . $name, '/');
    [$code, $body, , $err] = od_graph('PUT', od_item($rel, 'content'), ['Content-Type: application/octet-stream'], (string) file_get_contents($tmpFile));
    if (!in_array($code, [200, 201], true)) {
        return ['', od_err($code, $body, $err)];
    }
    return od_fetch($rel);
}

/** Wandelt eine Office-Datei über OneDrive in PDF um (Zwischenablage „PDF-Stift-Umwandlung“, danach gelöscht). */
function od_convert(string $tmpFile, string $ext, string $out): string
{
    if (od_token() === '') {
        return 'OneDrive ist nicht verbunden.';
    }
    $c = od_cfg();
    $name = 'PDF-Stift-Umwandlung/' . bin2hex(random_bytes(6)) . '.' . $ext;
    [$code, $body, , $err] = od_graph('PUT', '/me/drive/root:/' . od_enc($name) . ':/content', ['Content-Type: application/octet-stream'], (string) file_get_contents($tmpFile));
    if (!in_array($code, [200, 201], true)) {
        return od_err($code, $body, $err);
    }
    $item = json_decode($body, true) ?: [];
    $e = od_download('/me/drive/items/' . rawurlencode((string) ($item['id'] ?? '')) . '/content?format=pdf', $out);
    od_graph('DELETE', '/me/drive/items/' . rawurlencode((string) ($item['id'] ?? '')));
    return $e;
}
