<?php
declare(strict_types=1);

/*
 * Öffentliche Demo (z. B. https://example.org/demo/): in config.php
 *   'demo' => ['key' => '<geheimer Schlüssel für den Cronjob>', 'password' => 'demo',
 *              'seed' => ['https://…/beispiel.pdf', …], 'credit' => 'Beispiel-Artikel: …, CC BY 4.0']
 * Zurücksetzen (stündlich per Cronjob):  https://example.org/demo/api.php?a=demoreset&key=<Schlüssel>
 * Dabei wird alles Hochgeladene und Geschriebene gelöscht und die Beispiel-PDFs frisch hingelegt.
 */

const DEMO_QUOTA = 300 * 1024 * 1024;   // insgesamt höchstens 300 MB bis zum nächsten Zurücksetzen
const DEMO_FILE_MAX = 25 * 1024 * 1024; // je Datei höchstens 25 MB

function demo_cfg(): ?array
{
    $d = cfg()['demo'] ?? null;
    return is_array($d) ? $d : null;
}
function demo_on(): bool { return demo_cfg() !== null && !is_local(); }

function demo_dir_size(string $dir): int
{
    if (!is_dir($dir)) {
        return 0;
    }
    $n = 0;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        if ($f->isFile()) {
            $n += $f->getSize();
        }
    }
    return $n;
}

/** Vor jedem Schreiben: Demo nicht vollschreiben lassen */
function demo_guard(string $a): void
{
    if (!demo_on()) {
        return;
    }
    $blocked = ['totp_setup', 'totp_enable', 'totp_disable', 'token', 'restore', 'purgebackup', 'srvupdate', 'shrinkset', 'ncbackup', 'ncset', 'odset', 'odlogin'];
    if (in_array($a, $blocked, true)) {
        fail('In der Demo nicht möglich.', 403);
    }
    // gemeinsame Einstellungen (Oberfläche, Unterschrift …) würden sonst bei allen Besuchern landen
    if ($a === 'prefs' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        json_out(['ok' => true]);
    }
    $writes = ['upload', 'imgput', 'audioput', 'convert', 'burn', 'pageop', 'protect'];
    if (!in_array($a, $writes, true) || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        return;
    }
    foreach ($_FILES as $f) {
        foreach ((array) ($f['size'] ?? []) as $sz) {
            if ((int) $sz > DEMO_FILE_MAX) {
                fail('In der Demo sind Dateien bis 25 MB möglich.', 413);
            }
        }
    }
    if (demo_dir_size(rtrim(cfg()['storage'], '/')) > DEMO_QUOTA) {
        fail('Die Demo ist gerade voll – sie wird zur nächsten vollen Stunde zurückgesetzt.', 507);
    }
}

/** Alles löschen und die Beispiel-PDFs frisch hinlegen */
function demo_reset(string $key): array
{
    $d = demo_cfg();
    if (!$d || !hash_equals((string) ($d['key'] ?? ''), $key) || strlen($key) < 16) {
        fail('Nicht erlaubt.', 403);
    }
    $root = rtrim(cfg()['storage'], '/');
    $seedDir = dirname($root) . '/demo-seed';
    if (!is_dir($seedDir)) {
        mkdir($seedDir, 0775, true);
    }
    // Beispiel-PDFs einmal holen und aufheben
    $seeds = [];
    foreach ((array) ($d['seed'] ?? []) as $url) {
        $name = basename((string) parse_url((string) $url, PHP_URL_PATH));
        if (!preg_match('/^[\w.\- ]+\.pdf$/i', $name)) {
            continue;
        }
        $f = $seedDir . '/' . $name;
        if (!is_file($f) || filesize($f) < 100) {
            $bin = @file_get_contents((string) $url, false, stream_context_create(['http' => ['timeout' => 30, 'user_agent' => 'PDF-Stift-Demo']]));
            if ($bin !== false && str_starts_with($bin, '%PDF')) {
                file_put_contents($f, $bin);
            }
        }
        if (is_file($f)) {
            $seeds[] = $f;
        }
    }
    // alles unter storage/ löschen (Notizen, Notizbücher, Bilder, Suchindex, Sitzungen bleiben unberührt: die liegen beim Hoster)
    if (is_dir($root)) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
    }
    $pdfs = storage('pdfs');
    foreach ($seeds as $f) {
        copy($f, $pdfs . '/' . basename($f));
    }
    file_put_contents($root . '/demo-reset.txt', (string) time());
    return ['ok' => true, 'pdfs' => array_map('basename', $seeds), 'at' => date('c')];
}

/** Für die Oberfläche: Hinweisband und vorausgefülltes Passwort */
function demo_public(): ?array
{
    if (!demo_on()) {
        return null;
    }
    $d = demo_cfg();
    $f = rtrim(cfg()['storage'], '/') . '/demo-reset.txt';
    return ['password' => (string) ($d['password'] ?? 'demo'), 'credit' => (string) ($d['credit'] ?? ''), 'last' => is_file($f) ? (int) file_get_contents($f) : 0];
}
