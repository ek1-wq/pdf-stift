<?php
declare(strict_types=1);

/*
 * Volltextsuche über die ganze Bibliothek.
 * Der Text jeder Seite liegt in storage/search.sqlite (SQLite-Volltextindex FTS5, sonst einfache Tabelle).
 * Gefüllt wird der Index nachts vom Cronjob (Ghostscript liest den Text) und sofort vom Browser,
 * wenn eine PDF geöffnet wird, die noch nicht erfasst ist, oder nach der Texterkennung (OCR) eines Scans.
 */

const SCAN_RATIO = 0.5;   // weniger als die Hälfte der Seiten mit Text → gilt als Scan

function search_db(): ?PDO
{
    static $db = false;
    if ($db !== false) {
        return $db;
    }
    $db = null;
    if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        return null;
    }
    try {
        $d = new PDO('sqlite:' . storage() . '/search.sqlite');
        $d->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $d->exec('PRAGMA busy_timeout = 8000');
        $d->exec('PRAGMA journal_mode = WAL');
        $d->exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
        $d->exec('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, mtime INTEGER, size INTEGER, pages INTEGER, textpages INTEGER, src TEXT, t INTEGER)');
        $fts = $d->query("SELECT v FROM meta WHERE k = 'fts'")->fetchColumn();
        if ($fts === false) {
            try {
                $d->exec("CREATE VIRTUAL TABLE pages USING fts5(path UNINDEXED, page UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2')");
                $fts = '1';
            } catch (Throwable $e) {
                $d->exec('CREATE TABLE IF NOT EXISTS pages (path TEXT, page INTEGER, body TEXT)');
                $d->exec('CREATE INDEX IF NOT EXISTS pages_path ON pages(path)');
                $fts = '0';
            }
            $d->prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('fts', ?)")->execute([$fts]);
        }
        $db = $d;
    } catch (Throwable $e) {
        $db = null;
    }
    return $db;
}

function search_has_fts(): bool
{
    $d = search_db();
    return $d && $d->query("SELECT v FROM meta WHERE k = 'fts'")->fetchColumn() === '1';
}

/** Seitentext aufbereiten: Leerraum zusammenfassen, Silbentrennung am Zeilenende auflösen. */
function search_clean(string $t): string
{
    $t = str_replace(["\r", "\f", "\0"], ["\n", "\n", ''], $t);
    $t = (string) preg_replace('/(\p{Ll})-\s*\n\s*(\p{Ll})/u', '$1$2', $t);
    $t = (string) preg_replace('/\s+/u', ' ', $t);
    return trim(mb_substr($t, 0, 60000));
}

/** Text einer PDF in den Index schreiben (eine Zeile pro Seite, Seiten ab 0 gezählt). */
/** Text einer Seite (0-basiert) aus dem Suchindex, leer wenn unbekannt */
function index_page_text(string $rel, int $page): string
{
    $d = search_db();
    if (!$d) {
        return '';
    }
    try {
        $st = $d->prepare('SELECT body FROM pages WHERE path = ? AND page = ?');
        $st->execute([$rel, $page]);
        return (string) ($st->fetchColumn() ?: '');
    } catch (Throwable $e) {
        return '';
    }
}

function index_put(string $rel, int $mtime, int $size, array $texts, string $src): array
{
    $d = search_db();
    if (!$d) {
        return ['pages' => 0, 'textpages' => 0];
    }
    $texts = array_map(fn ($t) => search_clean((string) $t), array_values($texts));
    $withText = count(array_filter($texts, fn ($t) => mb_strlen($t) >= 25));
    $d->beginTransaction();
    try {
        $d->prepare('DELETE FROM pages WHERE path = ?')->execute([$rel]);
        $ins = $d->prepare('INSERT INTO pages (path, page, body) VALUES (?, ?, ?)');
        foreach ($texts as $i => $t) {
            if ($t !== '') {
                $ins->execute([$rel, $i, $t]);
            }
        }
        $d->prepare('INSERT OR REPLACE INTO docs (path, mtime, size, pages, textpages, src, t) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$rel, $mtime, $size, count($texts), $withText, $src, time()]);
        $d->commit();
    } catch (Throwable $e) {
        $d->rollBack();
        throw $e;
    }
    return ['pages' => count($texts), 'textpages' => $withText];
}

function index_doc(string $rel): ?array
{
    $d = search_db();
    if (!$d) {
        return null;
    }
    $st = $d->prepare('SELECT * FROM docs WHERE path = ?');
    $st->execute([$rel]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ?: null;
}

function index_fresh(?array $doc, array $f): bool
{
    return $doc && (int) $doc['mtime'] === (int) $f['mtime'] && (int) $doc['size'] === (int) $f['size'];
}

/** Text mit Ghostscript lesen – eine Datei pro Seite. */
function index_extract_gs(string $rel): ?array
{
    if (!function_exists('gs_path') || gs_path() === '') {
        return null;
    }
    $file = pdf_abs($rel);
    $dir = storage('tmp') . '/idx-' . bin2hex(random_bytes(6));
    mkdir($dir, 0775, true);
    try {
        [$code] = run_cmd([gs_path(), '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=txtwrite', '-sOutputFile=' . $dir . '/p-%d.txt', $file], 600, $dir);
        $out = [];
        for ($i = 1; is_file($dir . '/p-' . $i . '.txt'); $i++) {
            $out[] = (string) file_get_contents($dir . '/p-' . $i . '.txt');
        }
        return $code === 0 || $out ? $out : null;
    } finally {
        rrmdir($dir);
    }
}

/** Index auf den Stand der Bibliothek bringen, bis die Zeit um ist. */
function index_batch(int $budget): array
{
    $start = time();
    $d = search_db();
    if (!$d) {
        return ['done' => 0, 'error' => 'SQLite fehlt'];
    }
    $files = list_pdfs()['files'];
    $have = [];
    foreach ($d->query('SELECT * FROM docs')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $have[$r['path']] = $r;
    }
    // Gelöschte oder verschobene PDFs austragen
    $paths = array_flip(array_column($files, 'path'));
    foreach (array_keys($have) as $p) {
        if (!isset($paths[$p]) && !(is_board($p) && function_exists('board_abs') && is_file(nb_root() . '/' . substr($p, strlen(NB_PREFIX)) . '.board'))) {
            $d->prepare('DELETE FROM pages WHERE path = ?')->execute([$p]);
            $d->prepare('DELETE FROM docs WHERE path = ?')->execute([$p]);
        }
    }
    $n = 0;
    $failed = 0;
    // kleinste zuerst: so ist möglichst viel schnell durchsuchbar
    usort($files, fn ($a, $b) => $a['size'] <=> $b['size']);
    foreach ($files as $f) {
        if (time() - $start > $budget) {
            break;
        }
        $h = $have[$f['path']] ?? null;
        if (index_fresh($h, $f)) {
            continue;
        }
        $texts = index_extract_gs($f['path']);
        if ($texts === null) {
            $failed++;
            continue;
        }
        // Text aus der Texterkennung (OCR) nicht durch leeren Scan-Text ersetzen
        if ($h && $h['src'] === 'ocr' && !array_filter($texts, fn ($t) => trim($t) !== '')) {
            $d->prepare('UPDATE docs SET mtime = ?, size = ? WHERE path = ?')->execute([$f['mtime'], $f['size'], $f['path']]);
            continue;
        }
        index_put($f['path'], (int) $f['mtime'], (int) $f['size'], $texts, 'gs');
        $n++;
    }
    return ['done' => $n, 'failed' => $failed];
}

function index_status(?array $files = null): array
{
    $d = search_db();
    $files ??= list_pdfs()['files'];
    $out = ['ok' => (bool) $d, 'fts' => $d ? search_has_fts() : false, 'gs' => function_exists('gs_path') && gs_path() !== '',
        'total' => count($files), 'indexed' => 0, 'pending' => 0, 'scans' => []];
    if (!$d) {
        return $out;
    }
    $have = [];
    foreach ($d->query('SELECT path, mtime, size, pages, textpages FROM docs')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $have[$r['path']] = $r;
    }
    foreach ($files as $f) {
        $h = $have[$f['path']] ?? null;
        if (index_fresh($h, $f)) {
            $out['indexed']++;
            if ((int) $h['pages'] > 0 && (int) $h['textpages'] < (int) $h['pages'] * SCAN_RATIO) {
                $out['scans'][] = ['path' => $f['path'], 'pages' => (int) $h['pages'], 'textpages' => (int) $h['textpages']];
            }
        } else {
            $out['pending']++;
        }
    }
    return $out;
}

/** Suchbegriffe zerlegen (Wörter ab 2 Zeichen). */
function search_terms(string $q): array
{
    $parts = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($q), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return array_values(array_unique(array_filter($parts, fn ($p) => mb_strlen($p) >= 2)));
}

function search_snippet(string $body, array $terms, int $width = 90): string
{
    $low = mb_strtolower($body);
    $pos = null;
    foreach ($terms as $t) {
        $p = mb_strpos($low, $t);
        if ($p !== false && ($pos === null || $p < $pos)) {
            $pos = $p;
        }
    }
    $pos ??= 0;
    $from = max(0, $pos - $width);
    $s = mb_substr($body, $from, $width * 2 + 20);
    $s = ($from > 0 ? '…' : '') . $s . ($from + $width * 2 + 20 < mb_strlen($body) ? '…' : '');
    foreach ($terms as $t) {
        $s = (string) preg_replace('/(' . preg_quote($t, '/') . ')/iu', "\x01$1\x02", $s);
    }
    return $s;
}

/** Suche im Text aller PDFs. Treffer nach PDF gruppiert, beste zuerst. */
function search_query(string $q, int $limit = 400): array
{
    $terms = search_terms($q);
    $d = search_db();
    if (!$terms || !$d) {
        return ['docs' => [], 'total' => 0, 'terms' => $terms];
    }
    $rows = [];
    if (search_has_fts()) {
        $match = implode(' ', array_map(fn ($t) => '"' . str_replace('"', '""', $t) . '"*', $terms));
        $st = $d->prepare("SELECT path, page, snippet(pages, 2, char(1), char(2), '…', 16) AS snip FROM pages WHERE pages MATCH ? ORDER BY bm25(pages) LIMIT " . (int) $limit);
        $st->execute([$match]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $where = implode(' AND ', array_fill(0, count($terms), 'lower(body) LIKE ?'));
        $st = $d->prepare('SELECT path, page, body FROM pages WHERE ' . $where . ' LIMIT ' . (int) $limit);
        $st->execute(array_map(fn ($t) => '%' . $t . '%', $terms));
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $rows[] = ['path' => $r['path'], 'page' => $r['page'], 'snip' => search_snippet($r['body'], $terms)];
        }
    }
    $docs = [];
    foreach ($rows as $r) {
        $p = $r['path'];
        if (!isset($docs[$p])) {
            $docs[$p] = ['path' => $p, 'n' => 0, 'hits' => []];
        }
        $docs[$p]['n']++;
        if (count($docs[$p]['hits']) < 6) {
            $docs[$p]['hits'][] = ['page' => (int) $r['page'], 'snip' => $r['snip']];
        }
    }
    foreach ($docs as &$x) {
        usort($x['hits'], fn ($a, $b) => $a['page'] <=> $b['page']);
    }
    unset($x);
    return ['docs' => array_values($docs), 'total' => count($rows), 'more' => count($rows) >= $limit, 'terms' => $terms];
}

/** Suche in deinen eigenen Textfeldern (immer aktuell, direkt aus den Notizen). */
function search_notes(string $q, array $files): array
{
    $terms = search_terms($q);
    if (!$terms) {
        return [];
    }
    $out = [];
    foreach ($files as $f) {
        if (empty($f['notesMtime'])) {
            continue;
        }
        $raw = @file_get_contents(notes_file($f['path']));
        if ($raw === false || (!str_contains($raw, '"txt"') && !str_contains($raw, '"ob"'))) {
            continue;
        }
        $doc = json_decode($raw, true);
        foreach ((array) ($doc['strokes'] ?? []) as $s) {
            if (($s['t'] ?? '') === 'ob') {
                // Objekt (Textfeld, Form, Tabelle): sichtbarer Text
                $e = (array) ($s['e'] ?? []);
                $parts = [(string) ($e['html'] ?? '')];
                foreach ((array) ($e['rows'] ?? []) as $row) {
                    foreach ((array) $row as $cell) {
                        $parts[] = (string) $cell;
                    }
                }
                $s['text'] = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags(str_replace(['</div>', '</li>', '<br>', '</td>'], ' ', implode(' ', $parts))), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
                if ($s['text'] === '') {
                    continue;
                }
            } elseif (($s['t'] ?? '') !== 'txt') {
                continue;
            }
            $text = (string) ($s['text'] ?? '');
            $low = mb_strtolower($text);
            $all = true;
            foreach ($terms as $t) {
                if (!str_contains($low, $t)) {
                    $all = false;
                    break;
                }
            }
            if ($all) {
                $out[] = ['path' => $f['path'], 'page' => (int) ($s['p'] ?? 0), 'snip' => search_snippet(str_replace("\n", ' ', $text), $terms, 70)];
                if (count($out) >= 60) {
                    return $out;
                }
            }
        }
    }
    return $out;
}
