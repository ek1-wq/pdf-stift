<?php
declare(strict_types=1);

/* Office → PDF: zuerst LibreOffice auf dem Server, sonst über die OneDrive-Anbindung. */

const OFFICE_EXT = ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'xls', 'xlsx', 'ods'];

function exec_ok(): bool
{
    if (!function_exists('proc_open')) {
        return false;
    }
    $dis = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    return !in_array('proc_open', $dis, true);
}

function soffice_path(): string
{
    static $p = null;
    if ($p !== null) {
        return $p;
    }
    $p = '';
    if (!exec_ok()) {
        return $p;
    }
    // mitgeliefertes LibreOffice (Windows-App der freien Ausgabe) oder eigener Pfad
    $env = (string) getenv('PDFSTIFT_SOFFICE');
    if ($env !== '' && is_file($env)) {
        return $p = $env;
    }
    foreach (['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/usr/bin/libreoffice'] as $c) {
        if (@is_executable($c)) {
            return $p = $c;
        }
    }
    return $p;
}

function convert_caps(): array
{
    $od = function_exists('od_token') && !empty(od_cfg()['refresh_token']);
    return ['soffice' => soffice_path() !== '', 'onedrive' => $od, 'office' => soffice_path() !== '' || $od];
}

/** Startet LibreOffice ohne Fenster mit eigenem Profil in $dir und wartet höchstens $max Sekunden. */
function soffice_run(array $args, string $dir, int $max): void
{
    $win = PHP_OS_FAMILY === 'Windows';
    $prof = $win ? 'file:///' . str_replace('\\', '/', $dir) . '/profil' : 'file://' . $dir . '/profil';
    $cmd = array_merge([soffice_path(), '--headless', '--norestore', '--nolockcheck', '--nologo', '-env:UserInstallation=' . $prof], $args);
    // unter Windows die Umgebung erben (LibreOffice braucht SystemRoot, TEMP …)
    $env = $win ? null : ['HOME' => $dir, 'PATH' => '/usr/bin:/bin:/usr/local/bin'];
    $nul = $win ? 'NUL' : '/dev/null';
    $p = proc_open($cmd, [0 => ['file', $nul, 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $nul, 'w']], $pipes, $dir, $env, $win ? ['bypass_shell' => true] : null);
    if (!is_resource($p)) {
        return;
    }
    $start = time();
    while (proc_get_status($p)['running'] && time() - $start < $max) {
        usleep(200000);
    }
    if (proc_get_status($p)['running']) {
        proc_terminate($p);
    }
    proc_close($p);
}

/** Wandelt $src (Endung $ext) in eine PDF unter $out um. Leer = ok, sonst Fehlermeldung. */
function office_to_pdf(string $src, string $ext, string $out, string $filter = 'pdf'): string
{
    $so = soffice_path();
    if ($so !== '') {
        $dir = storage('tmp') . '/conv-' . bin2hex(random_bytes(6));
        mkdir($dir, 0775, true);
        $in = $dir . '/datei.' . $ext;
        copy($src, $in);
        soffice_run(['--convert-to', $filter, '--outdir', $dir, $in], $dir, 300);
        $pdf = $dir . '/datei.pdf';
        $ok = is_file($pdf) && (string) file_get_contents($pdf, false, null, 0, 5) === '%PDF-';
        if ($ok) {
            if (!is_dir(dirname($out))) {
                mkdir(dirname($out), 0775, true);
            }
            rename($pdf, $out);
        }
        rrmdir($dir);
        if ($ok) {
            return '';
        }
    }
    if (function_exists('od_convert') && !empty(od_cfg()['refresh_token'])) {
        return od_convert($src, $ext, $out);
    }
    return $so !== ''
        ? 'Die Umwandlung in PDF ist fehlgeschlagen.'
        : 'Word/PowerPoint kann hier nicht umgewandelt werden: Auf dem Server fehlt LibreOffice. Verbinde OneDrive (dann wandelt Microsoft um) oder lade eine PDF hoch.';
}

function rrmdir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($dir);
}

/** Mehrere EMF/WMF/TIFF-Grafiken auf einmal in SVG umwandeln (ein LibreOffice-Aufruf). Liefert je Datei SVG-Text oder null. */
function vector_to_svg(array $f): array
{
    $so = soffice_path();
    if ($so === '') {
        fail('Auf dem Server ist kein LibreOffice installiert.', 501);
    }
    $names = (array) ($f['name'] ?? []);
    $tmps = (array) ($f['tmp_name'] ?? []);
    $errs = (array) ($f['error'] ?? []);
    if (!$names || count($names) > 80) {
        fail('Keine oder zu viele Grafiken.');
    }
    $dir = storage('tmp') . '/img-' . bin2hex(random_bytes(6));
    mkdir($dir, 0775, true);
    $ins = [];
    foreach ($names as $i => $n) {
        $ext = strtolower(pathinfo((string) $n, PATHINFO_EXTENSION));
        if (!in_array($ext, ['emf', 'wmf', 'tif', 'tiff'], true) || ($errs[$i] ?? 1) !== UPLOAD_ERR_OK || filesize($tmps[$i]) > 20 * 1024 * 1024) {
            continue;
        }
        $in = $dir . '/g' . (int) $i . '.' . $ext;
        move_uploaded_file($tmps[$i], $in);
        $ins[(int) $i] = $in;
    }
    $out = array_fill(0, count($names), null);
    if ($ins) {
        soffice_run(array_merge(['--convert-to', 'svg', '--outdir', $dir . '/svg'], array_values($ins)), $dir, 240);
        foreach ($ins as $i => $in) {
            $svg = $dir . '/svg/' . pathinfo($in, PATHINFO_FILENAME) . '.svg';
            if (is_file($svg) && filesize($svg) < 15 * 1024 * 1024) {
                $out[$i] = (string) file_get_contents($svg);
            }
        }
    }
    rrmdir($dir);
    return $out;
}


/** PowerPoint-Datei aus einem Import ablegen (gleiche Dateien nur einmal). Rückgabe: 'sha1.pptx' oder null. */
function pptx_store(string $tmp): ?string
{
    $size = (int) @filesize($tmp);
    if ($size < 100 || $size > 150 * 1024 * 1024 || (string) @file_get_contents($tmp, false, null, 0, 4) !== "PK\x03\x04") {
        return null;
    }
    $src = sha1_file($tmp) . '.pptx';
    $f = img_dir() . '/' . $src;
    return is_file($f) || @copy($tmp, $f) ? $src : null;
}

/** Alle Folien (auch ausgeblendete) als PDF – einmal umgewandelt, danach aus dem Zwischenspeicher. Leer = Fehler. */
function pptx_pdf(string $src): string
{
    if (!preg_match('/^[a-f0-9]{40}\.pptx$/', $src) || !is_file(img_dir() . '/' . $src)) {
        return '';
    }
    $pdf = img_dir() . '/' . substr($src, 0, 40) . '.folien.pdf';
    if (!is_file($pdf)) {
        if (soffice_path() === '') {
            return '';
        }
        $err = office_to_pdf(img_dir() . '/' . $src, 'pptx', $pdf, 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}');
        if ($err !== '' || !is_file($pdf)) {
            return '';
        }
    }
    return $pdf;
}
