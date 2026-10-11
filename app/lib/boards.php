<?php
declare(strict_types=1);

/*
 * Notizbücher mit unendlicher Tafel (wie OneNote / Endless Paper).
 * Ablage: storage/boards/<Notizbuch>/<Abschnitt>/<Seite>.board  (kleine JSON-Datei mit Titel und Reihenfolge)
 * Die Striche liegen wie bei PDFs in storage/notes – Schlüssel ist der Pfad „@nb/<Notizbuch>/<Abschnitt>/<Seite>“.
 */

const NB_PREFIX = '@nb/';

function is_board(string $rel): bool { return str_starts_with($rel, NB_PREFIX); }

function nb_root(): string { return storage('boards'); }

/** Dateipfad zu einem Notizbuch-Pfad (@nb/A/B/C → boards/A/B/C.board). */
function board_abs(string $rel): string
{
    $rel = safe_rel($rel);
    if (!is_board($rel) || substr_count($rel, '/') !== 3) {
        fail('Ungültige Notizseite.');
    }
    return nb_root() . '/' . substr($rel, strlen(NB_PREFIX)) . '.board';
}

/** PDF oder Notizseite – Hauptsache, die Datei gibt es. */
function doc_abs(string $rel): string
{
    return is_board(safe_rel($rel)) ? board_abs($rel) : pdf_abs($rel);
}

function nb_clean_name(string $s, string $fallback): string
{
    $s = trim((string) preg_replace('/[\/\\\\\x00-\x1F:*?"<>|]+/u', ' ', $s));
    $s = ltrim((string) preg_replace('/\s+/u', ' ', $s), '.@ ');
    $s = mb_substr($s, 0, 80);
    return $s !== '' ? $s : $fallback;
}

function nb_meta(string $dir): array
{
    $f = $dir . '/.meta.json';
    $m = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    return is_array($m) ? $m : [];
}

function nb_meta_save(string $dir, array $m): void
{
    file_put_contents($dir . '/.meta.json', json_encode($m, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function board_read(string $file): array
{
    $m = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($m) ? $m : [];
}

function nb_dirs(string $dir): array
{
    $out = [];
    foreach (scandir($dir) ?: [] as $n) {
        if ($n[0] !== '.' && is_dir($dir . '/' . $n)) {
            $out[] = $n;
        }
    }
    return $out;
}

const NB_COLORS = ['#1F4FD6', '#13804A', '#D6262B', '#A855F7', '#FF4A1C', '#0E7490', '#B45309', '#DB2777'];

/** Alle Notizbücher mit Abschnitten und Seiten. */
function list_boards(): array
{
    $root = nb_root();
    $books = [];
    foreach (nb_dirs($root) as $i => $nb) {
        $bm = nb_meta($root . '/' . $nb);
        $secs = [];
        foreach (nb_dirs($root . '/' . $nb) as $sec) {
            $sdir = $root . '/' . $nb . '/' . $sec;
            $sm = nb_meta($sdir);
            $pages = [];
            foreach (glob($sdir . '/*.board') ?: [] as $f) {
                $m = board_read($f);
                $rel = NB_PREFIX . $nb . '/' . $sec . '/' . basename($f, '.board');
                $nf = notes_file($rel);
                $mt = filemtime($f);
                $pages[] = [
                    'path' => $rel, 'title' => (string) ($m['title'] ?? basename($f, '.board')), 'order' => (float) ($m['order'] ?? $m['created'] ?? 0),
                    'created' => (int) ($m['created'] ?? $mt), 'mtime' => $mt, 'notesMtime' => is_file($nf) ? filemtime($nf) : 0,
                    'level' => (int) ($m['level'] ?? 0), 'thumb' => is_file(thumb_file($rel, $mt)), 'onenote' => !empty($m['onenote']),
                ];
            }
            usort($pages, fn ($a, $b) => [$a['order'], $a['created']] <=> [$b['order'], $b['created']]);
            $secs[] = ['name' => $sec, 'color' => $sm['color'] ?? NB_COLORS[count($secs) % count(NB_COLORS)], 'order' => (float) ($sm['order'] ?? 0), 'pages' => $pages];
        }
        usort($secs, fn ($a, $b) => [$a['order'], $a['name']] <=> [$b['order'], $b['name']]);
        $books[] = ['name' => $nb, 'color' => $bm['color'] ?? NB_COLORS[$i % count(NB_COLORS)], 'order' => (float) ($bm['order'] ?? 0), 'sections' => $secs];
    }
    usort($books, fn ($a, $b) => [$a['order'], $a['name']] <=> [$b['order'], $b['name']]);
    return $books;
}

function nb_unique(string $dir, string $name, string $ext = ''): string
{
    $try = $name;
    for ($i = 2; file_exists($dir . '/' . $try . $ext); $i++) {
        $try = $name . ' (' . $i . ')';
    }
    return $try;
}

/** Notizbuch und/oder Abschnitt anlegen (vorhandene bleiben). */
function nb_ensure(string $nb, string $sec = '', array $meta = []): array
{
    $nb = nb_clean_name($nb, 'Notizbuch');
    $dir = nb_root() . '/' . $nb;
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
        nb_meta_save($dir, ($meta['nb'] ?? []) + ['color' => NB_COLORS[count(nb_dirs(nb_root())) % count(NB_COLORS)], 'order' => time()]);
    }
    if ($sec !== '') {
        $sec = nb_clean_name($sec, 'Abschnitt');
        $sdir = $dir . '/' . $sec;
        if (!is_dir($sdir)) {
            mkdir($sdir, 0775, true);
            nb_meta_save($sdir, ($meta['sec'] ?? []) + ['color' => NB_COLORS[count(nb_dirs($dir)) % count(NB_COLORS)], 'order' => microtime(true)]);
        }
    }
    return [$nb, $sec];
}

/** Neue Seite anlegen. Rückgabe: Pfad @nb/... */
function board_create(string $nb, string $sec, string $title, array $extra = []): string
{
    [$nb, $sec] = nb_ensure($nb, $sec !== '' ? $sec : 'Allgemein');
    $dir = nb_root() . '/' . $nb . '/' . $sec;
    $title = trim($title) !== '' ? mb_substr(trim($title), 0, 200) : 'Unbenannte Seite';
    $file = nb_unique($dir, nb_clean_name($title, 'Seite'), '.board');
    $meta = $extra + ['title' => $title, 'created' => time(), 'order' => microtime(true), 'bg' => 'dots'];
    file_put_contents($dir . '/' . $file . '.board', json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return NB_PREFIX . $nb . '/' . $sec . '/' . $file;
}

/** Nach einer Änderung: Datum der Seite setzen und ihren Text in den Suchindex schreiben. */
function board_changed(string $rel): void
{
    $file = board_abs($rel);
    if (!is_file($file)) {
        return;
    }
    touch($file);
    clearstatcache();
    if (function_exists('index_put') && search_db()) {
        $m = board_read($file);
        $doc = read_notes($rel);
        $texts = [(string) ($m['title'] ?? '')];
        foreach ((array) $doc['strokes'] as $s) {
            if (($s['t'] ?? '') === 'txt') {
                $texts[] = (string) $s['text'];
            }
        }
        index_put($rel, filemtime($file), 0, [implode("\n", $texts)], 'board');
    }
}

/** Notizbuch, Abschnitt oder Seite in den Papierkorb (storage/papierkorb) legen. */
function nb_delete(string $path): void
{
    $path = safe_rel($path);
    if (!is_board($path)) {
        fail('Ungültiger Pfad.');
    }
    $inner = substr($path, strlen(NB_PREFIX));
    $depth = substr_count($inner, '/');
    $src = nb_root() . '/' . $inner . ($depth === 2 ? '.board' : '');
    if (!file_exists($src)) {
        fail('Nicht gefunden.', 404);
    }
    $trash = storage('papierkorb') . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(3));
    mkdir($trash, 0775, true);
    rename($src, $trash . '/' . basename($src));
    if ($depth === 2) {
        @copy(notes_file($path), $trash . '/' . basename($src) . '.notes.json');
        if (function_exists('search_db') && ($d = search_db())) {
            $d->prepare('DELETE FROM pages WHERE path = ?')->execute([$path]);
            $d->prepare('DELETE FROM docs WHERE path = ?')->execute([$path]);
        }
    }
}

/** Umbenennen: Notizbuch/Abschnitt (Ordner) oder Seitentitel. Gibt den neuen Pfad zurück. */
function nb_rename(string $path, string $name): string
{
    $path = safe_rel($path);
    if (!is_board($path)) {
        fail('Ungültiger Pfad.');
    }
    $inner = substr($path, strlen(NB_PREFIX));
    $depth = substr_count($inner, '/');
    if ($depth === 2) {
        // Seite: nur der Titel ändert sich, der Pfad bleibt (Notizen und Verweise bleiben gültig)
        $file = board_abs($path);
        $m = board_read($file);
        $m['title'] = mb_substr(trim($name), 0, 200) ?: ($m['title'] ?? 'Seite');
        file_put_contents($file, json_encode($m, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        board_changed($path);
        return $path;
    }
    $src = nb_root() . '/' . $inner;
    if (!is_dir($src)) {
        fail('Nicht gefunden.', 404);
    }
    $new = nb_clean_name($name, basename($src));
    $dst = dirname($src) . '/' . $new;
    if ($new === basename($src)) {
        return $path;
    }
    if (file_exists($dst)) {
        fail('Diesen Namen gibt es hier schon.');
    }
    // Notizen der enthaltenen Seiten ziehen mit um
    $oldPrefix = $path . '/';
    $newPath = NB_PREFIX . ltrim(substr($dst, strlen(nb_root())), '/');
    $moves = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS)) as $f) {
        if (str_ends_with($f->getFilename(), '.board')) {
            $rel = NB_PREFIX . ltrim(substr(substr($f->getPathname(), 0, -6), strlen(nb_root())), '/');
            $moves[$rel] = $newPath . '/' . substr($rel, strlen($oldPrefix));
        }
    }
    rename($src, $dst);
    foreach ($moves as $from => $to) {
        if (is_file(notes_file($from))) {
            $doc = json_decode((string) file_get_contents(notes_file($from)), true) ?: [];
            $doc['path'] = $to;
            file_put_contents(notes_file($to), json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            @unlink(notes_file($from));
        }
        if (function_exists('search_db') && ($d = search_db())) {
            $d->prepare('UPDATE pages SET path = ? WHERE path = ?')->execute([$to, $from]);
            $d->prepare('UPDATE docs SET path = ? WHERE path = ?')->execute([$to, $from]);
        }
    }
    return $newPath;
}

// ---------------------------------------------------------------- Bilder (für Tafeln und den OneNote-Import)

function img_dir(): string { return storage('images'); }

/** Bilddatei ablegen (gleiche Bilder nur einmal). Rückgabe: ['src' => 'sha1.ext', 'w', 'h'] oder null. */
function img_store_bytes(string $bin): ?array
{
    if (strlen($bin) < 20 || strlen($bin) > 25 * 1024 * 1024) {
        return null;
    }
    $info = @getimagesizefromstring($bin);
    $ext = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'][$info[2] ?? 0] ?? null;
    if (!$info || !$ext) {
        return null;
    }
    $src = sha1($bin) . '.' . $ext;
    $f = img_dir() . '/' . $src;
    if (!is_file($f)) {
        file_put_contents($f, $bin);
    }
    return ['src' => $src, 'w' => (int) $info[0], 'h' => (int) $info[1]];
}

function img_file(string $src): ?string
{
    if (!preg_match('/^[a-f0-9]{40}\.(jpg|png|gif|webp)$/', $src)) {
        return null;
    }
    $f = img_dir() . '/' . $src;
    return is_file($f) ? $f : null;
}
