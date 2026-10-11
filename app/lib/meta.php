<?php
declare(strict_types=1);

/*
 * Wissensbasis: Schlagwörter je Dokument und die Merkliste (gemerkte Seiten).
 * Gespeichert in storage/meta.json: { docs: { pfad: { tags: [...] } }, marks: [ { path, page, title, t } ] }
 */

function meta_file(): string { return storage() . '/meta.json'; }

function meta_read(): array
{
    $f = meta_file();
    $m = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
    return ['docs' => (array) ($m['docs'] ?? []), 'marks' => array_values((array) ($m['marks'] ?? []))];
}

function meta_write(array $m): void
{
    $f = meta_file();
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode(['docs' => (object) $m['docs'], 'marks' => array_values($m['marks'])], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($tmp, $f);
}

function meta_clean_tags(array $tags): array
{
    $out = [];
    foreach ($tags as $t) {
        $t = trim(preg_replace('/\s+/u', ' ', mb_substr((string) $t, 0, 40)));
        $t = ltrim($t, '#');
        if ($t !== '' && !in_array(mb_strtolower($t), array_map('mb_strtolower', $out), true)) {
            $out[] = $t;
        }
    }
    return array_slice($out, 0, 30);
}

/** Änderungen unter Sperre (mehrere Geräte gleichzeitig) */
function meta_update(callable $fn): array
{
    $lk = fopen(storage() . '/meta.lock', 'c');
    flock($lk, LOCK_EX);
    $m = meta_read();
    $m = $fn($m);
    meta_write($m);
    flock($lk, LOCK_UN);
    fclose($lk);
    return $m;
}

/** Datei verschoben/umbenannt: Schlagwörter und Merkliste mitnehmen */
function meta_move(string $from, string $to): void
{
    if (!is_file(meta_file())) {
        return;
    }
    meta_update(function (array $m) use ($from, $to) {
        if (isset($m['docs'][$from])) {
            $m['docs'][$to] = $m['docs'][$from];
            unset($m['docs'][$from]);
        }
        foreach ($m['marks'] as &$k) {
            if (($k['path'] ?? '') === $from) {
                $k['path'] = $to;
            }
        }
        return $m;
    });
}

/** Wer verweist auf diese Datei? (Verknüpfungen in den Notizen aller PDFs und Notizbuchseiten) */
function meta_backlinks(string $rel): array
{
    $out = [];
    foreach (glob(storage('notes') . '/*.json') ?: [] as $f) {
        $raw = (string) file_get_contents($f);
        if (!str_contains($raw, '"ln"') || !str_contains($raw, json_encode($rel, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))) {
            continue;
        }
        $doc = json_decode($raw, true) ?: [];
        foreach ((array) ($doc['strokes'] ?? []) as $s) {
            if (($s['ln']['path'] ?? '') === $rel) {
                $out[] = ['from' => (string) ($doc['path'] ?? ''), 'page' => (int) ($s['p'] ?? 0), 'text' => (string) ($s['text'] ?? ''), 'pg' => (int) ($s['ln']['pg'] ?? 0), 'img' => ($s['t'] ?? '') === 'img', 'id' => (string) ($s['id'] ?? '')];
            }
        }
    }
    return $out;
}
