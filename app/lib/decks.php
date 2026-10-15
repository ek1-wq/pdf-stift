<?php
declare(strict_types=1);

/*
 * Präsentationen: eigene Folien, als JSON gespeichert (storage/decks/<id>.json).
 * Folien und die Stiftnotizen darauf sind getrennt – die Folien bleiben immer bearbeitbar.
 */

function deck_dir(): string { return storage('decks'); }

function deck_id(string $path): string
{
    if (!preg_match('#^@dk/([a-z0-9]{12})$#', $path, $m)) {
        fail('Unbekannte Präsentation.', 404);
    }
    return $m[1];
}

function deck_file(string $path): string { return deck_dir() . '/' . deck_id($path) . '.json'; }

function deck_read(string $path): array
{
    $f = deck_file($path);
    if (!is_file($f)) {
        fail('Diese Präsentation gibt es nicht mehr.', 404);
    }
    $d = json_decode((string) file_get_contents($f), true);
    if (!is_array($d)) {
        fail('Die Präsentation ist beschädigt.', 500);
    }
    return $d;
}

function deck_list(): array
{
    $out = [];
    foreach (glob(deck_dir() . '/*.json') ?: [] as $f) {
        $d = json_decode((string) file_get_contents($f), true);
        if (!is_array($d)) {
            continue;
        }
        // für das Vorschaubild: nur das Layout der ersten Folie (der ganze Master wäre zu groß für die Liste)
        $lay = null;
        $first = $d['slides'][0] ?? null;
        if (is_array($first) && isset($first['lay']) && isset($d['master']['layouts']) && is_array($d['master']['layouts'])) {
            foreach ($d['master']['layouts'] as $L) {
                if (is_array($L) && ($L['id'] ?? '') === $first['lay']) {
                    $lay = ['name' => (string) ($d['master']['name'] ?? ''), 'layouts' => [$L]];
                    break;
                }
            }
        }
        $out[] = [
            'path' => '@dk/' . basename($f, '.json'),
            'title' => (string) ($d['title'] ?? 'Präsentation'),
            'slides' => count((array) ($d['slides'] ?? [])),
            'mtime' => filemtime($f),
            'rev' => (int) ($d['rev'] ?? 0),
            'first' => $d['slides'][0] ?? null,
            'theme' => $d['theme'] ?? null,
            'master' => $lay,
            'tpl' => !empty($d['tpl']) && isset($d['master']),
        ];
    }
    usort($out, fn ($a, $b) => $b['mtime'] <=> $a['mtime']);
    return $out;
}

/** Neue Präsentation aus einer Vorlage: Folienmaster, Design und Fußzeile, aber keine Folien */
function deck_from_tpl(string $path): array
{
    $t = deck_read($path);
    $d = ['v' => 1];
    foreach (['w', 'h', 'theme', 'master', 'hf'] as $k) {
        if (isset($t[$k])) {
            $d[$k] = $t[$k];
        }
    }
    $d['slides'] = [];
    return $d;
}

function deck_new(string $title, ?array $copyOf = null): array
{
    $title = trim(mb_substr($title, 0, 200)) ?: 'Neue Präsentation';
    do {
        $id = substr(bin2hex(random_bytes(8)), 0, 12);
    } while (is_file(deck_dir() . '/' . $id . '.json'));
    $d = $copyOf ?? ['v' => 1, 'w' => 960, 'h' => 540, 'theme' => ['bg' => '#FFFFFF', 'fg' => '#1A1A1A', 'accent' => '#1E2F6E', 'font' => 'sans'], 'slides' => []];
    $d['title'] = $title;
    $d['rev'] = 1;
    file_put_contents(deck_dir() . '/' . $id . '.json', json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    return ['path' => '@dk/' . $id, 'title' => $title, 'rev' => 1];
}

/** Speichern mit Versionsprüfung: wurde inzwischen woanders gespeichert, gibt es 409 und den aktuellen Stand */
function deck_save(string $path, array $deck, int $baseRev): array
{
    $f = deck_file($path);
    $fp = fopen($f, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        fail('Speichern nicht möglich.', 500);
    }
    $cur = json_decode((string) stream_get_contents($fp), true);
    $rev = is_array($cur) ? (int) ($cur['rev'] ?? 0) : 0;
    if ($baseRev && $rev && $baseRev !== $rev) {
        flock($fp, LOCK_UN);
        fclose($fp);
        json_out(['conflict' => true, 'deck' => $cur], 409);
    }
    $j = json_encode($deck, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen((string) $j) > 20 * 1024 * 1024) {
        flock($fp, LOCK_UN);
        fclose($fp);
        fail('Die Präsentation ist zu groß.', 413);
    }
    // eine Sicherung des vorigen Stands (die letzten 20)
    if (is_array($cur)) {
        $bd = storage('decks/history/' . deck_id($path));
        file_put_contents($bd . '/' . date('Ymd-His') . '.json', json_encode($cur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $all = glob($bd . '/*.json') ?: [];
        sort($all);
        foreach (array_slice($all, 0, max(0, count($all) - 20)) as $old) {
            @unlink($old);
        }
    }
    // Verweis auf die Original-PowerPoint-Datei behalten, auch wenn ein älterer Stand ihn noch nicht kennt
    if (!isset($deck['src']) && is_array($cur) && isset($cur['src'])) {
        $deck['src'] = $cur['src'];
    }
    $deck['rev'] = $rev + 1;
    $deck['title'] = trim(mb_substr((string) ($deck['title'] ?? ($cur['title'] ?? 'Präsentation')), 0, 200)) ?: 'Präsentation';
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string) json_encode($deck, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    clearstatcache();
    return ['ok' => true, 'rev' => $deck['rev'], 'mtime' => filemtime($f)];
}

/** Original-PowerPoint-Datei an einer Präsentation vermerken, ohne den Bearbeitungsstand (rev) zu ändern */
function deck_set_src(string $path, string $src): bool
{
    $f = deck_file($path);
    if (!is_file($f) || !preg_match('/^[a-f0-9]{40}\.pptx$/', $src)) {
        return false;
    }
    $fp = fopen($f, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        return false;
    }
    $cur = json_decode((string) stream_get_contents($fp), true);
    if (is_array($cur)) {
        $cur['src'] = $src;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, (string) json_encode($cur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return is_array($cur);
}
