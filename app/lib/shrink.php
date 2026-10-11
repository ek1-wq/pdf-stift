<?php
declare(strict_types=1);

/*
 * PDFs im Hintergrund verkleinern – ohne sichtbaren Qualitätsverlust.
 *
 * 1. Ghostscript (falls auf dem Server): Bilder über 450 dpi werden auf 300 dpi gebracht, unkomprimierte Bilder
 *    sehr hochwertig (JPEG-Stufe „Maximum“) gespeichert, doppelte Bilder und Schriften nur einmal abgelegt.
 *    Bereits als JPEG gespeicherte Bilder bleiben unverändert.
 * 2. qpdf (falls vorhanden): verlustfrei aufräumen und für schnelles Laden der ersten Seite ordnen.
 *
 * Das Ergebnis wird nur übernommen, wenn es deutlich kleiner ist und Seitenzahl, Seitengrößen, Drehung und Text
 * gleich geblieben sind – sonst bleibt das Original. Das Original wird 7 Tage in storage/backup/verkleinert aufbewahrt.
 */

const SHRINK_MIN = 10 * 1024 * 1024;  // nur große Dateien ab 10 MB
const SHRINK_KEEP_DAYS = 7;

function shrink_file_state(): string { return storage() . '/shrink.json'; }

function shrink_state(): array
{
    $f = shrink_file_state();
    $s = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    $s = is_array($s) ? $s : [];
    $s += ['auto' => true, 'ncBack' => true, 'saved' => 0, 'count' => 0, 'files' => [], 'lastRun' => 0, 'lastInfo' => ''];
    if (empty($s['cronKey'])) {
        $s['cronKey'] = bin2hex(random_bytes(16));
        shrink_save($s);
    }
    return $s;
}

function shrink_cron_url(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'pdf-stift.example.org');
    $dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api.php'))), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir . '/cron.php?key=' . shrink_state()['cronKey'];
}

/** Arbeitet alle wartenden Dateien ab, bis die Zeit um ist. Für den Cronjob. */
function shrink_batch(int $budget): array
{
    $start = time();
    $done = ['smaller' => 0, 'same' => 0, 'error' => 0, 'saved' => 0, 'lines' => []];
    $tried = [];
    while (time() - $start < $budget) {
        $cand = array_values(array_filter(shrink_candidates(list_pdfs()['files'], shrink_state()), fn ($f) => !isset($tried[$f['path']])));
        if (!$cand) {
            break;
        }
        $f = $cand[0];
        $tried[$f['path']] = true;
        $r = shrink_pdf($f['path']);
        $done[$r['status']]++;
        if ($r['status'] === 'smaller') {
            $done['saved'] += $r['before'] - $r['after'];
        }
        $done['lines'][] = sprintf('%-8s %s  %s', $r['status'], $f['path'],
            (isset($r['after']) ? round($r['before'] / 1048576, 1) . ' MB → ' . round($r['after'] / 1048576, 1) . ' MB  ' : '') . ($r['note'] ?? ''));
    }
    $s = shrink_state();
    $s['lastRun'] = time();
    $s['lastInfo'] = $done['smaller'] . ' verkleinert (' . round($done['saved'] / 1048576) . ' MB gespart), ' . $done['same'] . ' unverändert'
        . ($done['error'] ? ', ' . $done['error'] . ' Fehler' : '');
    shrink_save($s);
    return $done;
}

function shrink_save(array $s): void
{
    $f = shrink_file_state();
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($s, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    rename($tmp, $f);
}

function find_bin(array $cands): string
{
    if (!exec_ok()) {
        return '';
    }
    foreach ($cands as $c) {
        if (@is_executable($c)) {
            return $c;
        }
    }
    return '';
}
function gs_path(): string
{
    static $p = null;
    return $p ??= find_bin(['/usr/bin/gs', '/usr/local/bin/gs', '/opt/homebrew/bin/gs', '/bin/gs']);
}
function qpdf_path(): string
{
    static $p = null;
    return $p ??= find_bin(['/usr/bin/qpdf', '/usr/local/bin/qpdf', '/opt/homebrew/bin/qpdf', '/bin/qpdf']);
}

/** Führt ein Programm mit Zeitlimit aus. Rückgabe: [Exit-Code, Ausgabe] (-1 = Zeitüberschreitung). */
function run_cmd(array $cmd, int $timeout, string $cwd): array
{
    $out = tempnam($cwd, 'out');
    $p = proc_open($cmd, [0 => ['file', '/dev/null', 'r'], 1 => ['file', $out, 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $cwd, ['PATH' => '/usr/bin:/bin:/usr/local/bin', 'HOME' => $cwd, 'TMPDIR' => $cwd]);
    if (!is_resource($p)) {
        return [-2, ''];
    }
    $start = microtime(true);
    $st = proc_get_status($p);
    while ($st['running'] && microtime(true) - $start < $timeout) {
        usleep(100000);
        $st = proc_get_status($p);
    }
    if ($st['running']) {
        proc_terminate($p, 9);
        proc_close($p);
        @unlink($out);
        return [-1, ''];
    }
    proc_close($p);
    $o = (string) file_get_contents($out);
    @unlink($out);
    return [(int) $st['exitcode'], $o];
}

/** Fingerabdruck der Seiten (Breite×Höhe×Drehung) – darf sich durchs Verkleinern nicht ändern. */
function pdf_pages_sig(string $file, string $dir): ?array
{
    $gs = gs_path();
    if ($gs === '') {
        return null;
    }
    $ps = '(' . str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $file) . ') (r) file runpdfbegin '
        . '1 1 pdfpagecount { pdfgetpage dup /CropBox pget { } { dup /MediaBox pget pop } ifelse == /Rotate pget { = } { 0 = } ifelse } for quit';
    [$code, $o] = run_cmd([$gs, '-q', '-dNODISPLAY', '-dSAFER', '--permit-file-read=' . $file, '-c', $ps], 120, $dir);
    if ($code !== 0 || !preg_match_all('/\[\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\]\s*\n\s*(-?\d+)/', $o, $m, PREG_SET_ORDER)) {
        return null;
    }
    $sig = [];
    foreach ($m as $x) {
        $w = abs((float) $x[3] - (float) $x[1]);
        $h = abs((float) $x[4] - (float) $x[2]);
        $rot = ((int) $x[5] % 360 + 360) % 360;
        // angezeigte Größe (Drehung eingerechnet) – darauf beziehen sich die Notizen
        $sig[] = $rot % 180 ? [round($h, 1), round($w, 1)] : [round($w, 1), round($h, 1)];
    }
    return $sig;
}

function sig_equal(array $a, array $b): bool
{
    if (count($a) !== count($b)) {
        return false;
    }
    foreach ($a as $i => $p) {
        if (abs($p[0] - $b[$i][0]) > 0.6 || abs($p[1] - $b[$i][1]) > 0.6) {
            return false;
        }
    }
    return true;
}

/** Stichprobe: Seiten klein rendern (Graustufen) – das Ergebnis muss genauso aussehen wie das Original. */
function pdf_render_pages(string $file, array $pages, string $dir, string $tag): ?array
{
    $out = [];
    foreach ($pages as $pg) {
        $f = $dir . '/r-' . $tag . '-' . $pg . '.pgm';
        [$code] = run_cmd([gs_path(), '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pgmraw', '-r40', '-dDOINTERPOLATE', '-dFirstPage=' . $pg, '-dLastPage=' . $pg, '-sOutputFile=' . $f, $file], 120, $dir);
        if ($code !== 0 || !is_file($f)) {
            return null;
        }
        $d = (string) file_get_contents($f);
        @unlink($f);
        if (!preg_match('/^P5\s+(?:#.*\s+)*(\d+)\s+(\d+)\s+(\d+)\s/', $d, $m)) {
            return null;
        }
        $out[$pg] = [(int) $m[1], (int) $m[2], substr($d, strlen($m[0]))];
    }
    return $out;
}

function renders_match(array $a, array $b): bool
{
    foreach ($a as $pg => [$w, $h, $px]) {
        if (!isset($b[$pg]) || abs($b[$pg][0] - $w) > 1 || abs($b[$pg][1] - $h) > 1) {
            return false;
        }
        if ($b[$pg][0] !== $w || $b[$pg][1] !== $h) {
            continue; // Rundung um einen Pixel – Größe passt, Inhalt nicht vergleichbar
        }
        // in 3×3-Blöcken mitteln: Bildrauschen (z. B. bei Scans) zählt nicht, verschobene oder fehlende Inhalte schon
        $q = $b[$pg][2];
        $sum = 0;
        $cnt = 0;
        for ($y = 0; $y + 3 <= $h; $y += 3) {
            for ($x = 0; $x + 3 <= $w; $x += 3) {
                $s1 = 0;
                $s2 = 0;
                for ($dy = 0; $dy < 3; $dy++) {
                    $o = ($y + $dy) * $w + $x;
                    $s1 += ord($px[$o]) + ord($px[$o + 1]) + ord($px[$o + 2]);
                    $s2 += ord($q[$o]) + ord($q[$o + 1]) + ord($q[$o + 2]);
                }
                $sum += abs($s1 - $s2) / 9;
                $cnt++;
            }
        }
        if (getenv('PDFSTIFT_DEBUG')) {
            fwrite(STDERR, 'Seite ' . $pg . ': mittlere Abweichung ' . round($sum / max(1, $cnt), 2) . "\n");
        }
        if ($cnt && $sum / $cnt > 0.5) {
            return false; // gleich aussehende Seiten liegen bei < 0,1, eine andere Folie bei ~1
        }
    }
    return true;
}

/** Text der PDF ohne Leerraum – damit Suche und Text-Markierungen nachher genauso funktionieren. */
function pdf_text_len(string $file, string $dir): int
{
    $gs = gs_path();
    $txt = $dir . '/text-' . bin2hex(random_bytes(4)) . '.txt';
    [$code] = run_cmd([$gs, '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-sOutputFile=' . $txt, $file], 240, $dir);
    $t = $code === 0 && is_file($txt) ? (string) file_get_contents($txt) : '';
    @unlink($txt);
    return $code === 0 ? mb_strlen((string) preg_replace('/\s+/u', '', $t)) : -1;
}

function shrink_caps(): array
{
    return ['gs' => gs_path() !== '', 'qpdf' => qpdf_path() !== '', 'ok' => gs_path() !== '' || qpdf_path() !== ''];
}

/** Dateien, die noch geprüft werden müssen (größte zuerst). */
function shrink_candidates(array $files, array $state): array
{
    $c = [];
    foreach ($files as $f) {
        if ($f['size'] < SHRINK_MIN) {
            continue;
        }
        $s = $state['files'][$f['path']] ?? null;
        if ($s && (int) $s['size'] === (int) $f['size'] && (int) $s['mtime'] === (int) $f['mtime']) {
            continue; // schon bearbeitet bzw. lohnt sich nicht
        }
        $c[] = $f;
    }
    usort($c, fn ($a, $b) => $b['size'] <=> $a['size']);
    return $c;
}

function shrink_public(array $files): array
{
    $s = shrink_state();
    $caps = shrink_caps();
    $pend = $caps['ok'] ? shrink_candidates($files, $s) : [];
    return $caps + [
        'auto' => (bool) $s['auto'], 'ncBack' => (bool) $s['ncBack'], 'ncOn' => !empty(nc_cfg()['url']), 'saved' => (int) $s['saved'], 'count' => (int) $s['count'],
        'pending' => count($pend), 'pendingBytes' => array_sum(array_column($pend, 'size')), 'minMB' => SHRINK_MIN / 1048576,
        'lastRun' => (int) $s['lastRun'], 'lastInfo' => (string) $s['lastInfo'],
        'cronUrl' => shrink_cron_url(), 'cronCli' => 'php ' . dirname(__DIR__) . '/cron.php',
    ];
}

/** Aus Nextcloud übernommene PDF: verkleinerte Fassung auch dort ablegen (Nextcloud hebt die alte als Version auf). */
function shrink_nc_back(string $rel, string $file): string
{
    $c = nc_cfg();
    $old = $c['etags'][$rel] ?? '';
    if (empty($c['url']) || $old === '') {
        return '';
    }
    $dir = str_contains($rel, '/') ? dirname($rel) : '';
    [$items, $err] = nc_list($c, $dir);
    if ($err) {
        return 'Nextcloud: ' . $err;
    }
    $it = null;
    foreach ($items as $x) {
        if ($x['rel'] === $rel) {
            $it = $x;
        }
    }
    if (!$it || $it['etag'] !== $old) {
        return 'Nextcloud: Datei wurde dort inzwischen geändert – nicht ersetzt.';
    }
    [$code, , $e] = nc_http($c, 'PUT', nc_base($c) . nc_enc_path($rel), ['Content-Type: application/pdf'], (string) file_get_contents($file));
    if (!in_array($code, [200, 201, 204], true)) {
        return 'Nextcloud: Hochladen fehlgeschlagen (' . ($e ?: 'HTTP ' . $code) . ').';
    }
    [$items] = nc_list($c, $dir);
    foreach ($items as $x) {
        if ($x['rel'] === $rel) {
            nc_set_etag($rel, $x['etag']); // sonst würde der Abgleich die Datei wieder herunterladen
        }
    }
    return '';
}

/** Verkleinert eine PDF. Rückgabe: ['status' => 'smaller'|'same'|'error', 'before', 'after', 'note'] */
function shrink_pdf(string $rel): array
{
    $file = pdf_abs($rel);
    clearstatcache();
    if (!is_file($file)) {
        return ['status' => 'error', 'note' => 'Datei nicht gefunden.'];
    }
    $before = filesize($file);
    $mtime = filemtime($file);
    $state = shrink_state();
    $record = function (int $size, string $status, string $note = '') use (&$state, $rel, $mtime, $before) {
        $state['files'][$rel] = ['size' => $size, 'mtime' => $mtime, 'from' => $before, 'status' => $status, 'note' => $note, 't' => time()];
        shrink_save($state);
    };
    $gs = gs_path();
    $qpdf = qpdf_path();
    if ($gs === '' && $qpdf === '') {
        return ['status' => 'error', 'note' => 'Auf dem Server fehlt Ghostscript/qpdf.'];
    }
    @set_time_limit(600);
    $dir = storage('tmp') . '/shrink-' . bin2hex(random_bytes(6));
    mkdir($dir, 0775, true);
    $cur = $file;
    $notes = [];
    try {
        if ($gs !== '') {
            $sig0 = pdf_pages_sig($file, $dir);
            $out = $dir . '/gs.pdf';
            $hq = '<< /ColorACSImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> '
                . '/GrayACSImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> setdistillerparams';
            [$code] = run_cmd([
                $gs, '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
                '-dAutoRotatePages=/None', '-dPreserveAnnots=true', '-dDetectDuplicateImages=true', '-dSubsetFonts=true', '-dCompressFonts=true',
                '-dPassThroughJPEGImages=true', '-dPassThroughJPXImages=true',
                '-dDownsampleColorImages=true', '-dColorImageResolution=300', '-dColorImageDownsampleThreshold=1.5', '-dColorImageDownsampleType=/Bicubic',
                '-dDownsampleGrayImages=true', '-dGrayImageResolution=300', '-dGrayImageDownsampleThreshold=1.5', '-dGrayImageDownsampleType=/Bicubic',
                '-dDownsampleMonoImages=false',
                '-sOutputFile=' . $out, '-c', $hq, '-f', $file,
            ], 420, $dir);
            $ok = $code === 0 && is_file($out) && filesize($out) > 0 && (string) file_get_contents($out, false, null, 0, 5) === '%PDF-';
            if ($ok && filesize($out) < $before * 0.97) {
                $sig1 = pdf_pages_sig($out, $dir);
                if ($sig0 === null || $sig1 === null || !sig_equal($sig0, $sig1)) {
                    $ok = false;
                    $notes[] = 'Seitenformat hätte sich geändert';
                } else {
                    $t0 = pdf_text_len($file, $dir);
                    $t1 = pdf_text_len($out, $dir);
                    if ($t0 < 0 || $t1 < 0 || ($t0 > 0 && abs($t1 - $t0) > max(20, $t0 * 0.02))) {
                        $ok = false;
                        $notes[] = 'Text wäre nicht mehr gleich durchsuchbar';
                    } else {
                        $n = count($sig0);
                        $sample = array_values(array_unique([1, max(1, intdiv($n + 1, 2)), $n]));
                        $r0 = pdf_render_pages($file, $sample, $dir, 'a');
                        $r1 = pdf_render_pages($out, $sample, $dir, 'b');
                        if (!$r0 || !$r1 || !renders_match($r0, $r1)) {
                            $ok = false;
                            $notes[] = 'Seiten hätten anders ausgesehen';
                        }
                    }
                }
                if ($ok) {
                    $cur = $out;
                }
            }
        }
        if ($qpdf !== '') {
            $out2 = $dir . '/q.pdf';
            [$code] = run_cmd([$qpdf, '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--linearize', $cur, $out2], 300, $dir);
            // 0 = gut, 3 = mit Warnungen, aber gültig
            if (($code === 0 || $code === 3) && is_file($out2) && filesize($out2) > 0 && filesize($out2) < filesize($cur)) {
                [$c2, $n] = run_cmd([$qpdf, '--show-npages', $out2], 60, $dir);
                [$c1, $n0] = run_cmd([$qpdf, '--show-npages', $file], 60, $dir);
                if ($c2 === 0 && (int) $n > 0 && ($c1 !== 0 || (int) $n === (int) $n0)) {
                    $cur = $out2;
                }
            }
        }
        clearstatcache();
        $after = $cur === $file ? $before : filesize($cur);
        // Lohnt es sich? mindestens 10 % oder 1 MB kleiner
        if ($cur === $file || ($before - $after < $before * 0.10 && $before - $after < 1024 * 1024)) {
            $record($before, 'same', implode('; ', $notes));
            return ['status' => 'same', 'before' => $before, 'after' => $before, 'note' => implode('; ', $notes)];
        }
        // Datei hat sich in der Zwischenzeit geändert (z. B. Seite eingefügt)? Dann nicht überschreiben.
        clearstatcache();
        if (filesize($file) !== $before || filemtime($file) !== $mtime) {
            return ['status' => 'error', 'note' => 'Datei wurde inzwischen geändert.'];
        }
        // Original 7 Tage aufheben
        $bdir = storage('backup/verkleinert');
        foreach (glob($bdir . '/*') ?: [] as $old) {
            if (time() - filemtime($old) > SHRINK_KEEP_DAYS * 86400) {
                @unlink($old);
            }
        }
        $backup = $bdir . '/' . sha1($rel) . '-' . preg_replace('/[^\w.-]/', '_', basename($rel));
        @unlink($backup);
        if (!@link($file, $backup)) {
            copy($file, $backup);
        }
        @touch($backup);
        $tmp = dirname($file) . '/.shrink-' . bin2hex(random_bytes(4)) . '.pdf';
        if (!@rename($cur, $tmp)) {
            copy($cur, $tmp);
        }
        rename($tmp, $file);
        touch($file, $mtime); // Datum bleibt, Vorschaubild bleibt gültig
        clearstatcache();
        $state['saved'] = (int) $state['saved'] + ($before - $after);
        $state['count'] = (int) $state['count'] + 1;
        $note = '';
        if (!empty($state['ncBack']) && function_exists('nc_cfg')) {
            $note = shrink_nc_back($rel, $file);
            if ($note === '' && !empty(nc_cfg()['etags'][$rel])) {
                $note = 'auch in Nextcloud ersetzt';
            }
        }
        $record($after, 'smaller', $note);
        return ['status' => 'smaller', 'before' => $before, 'after' => $after, 'note' => $note];
    } finally {
        rrmdir($dir);
    }
}
