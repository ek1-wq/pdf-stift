<?php
declare(strict_types=1);

/*
 * Anmeldung absichern:
 *  - Sperre nach Fehlversuchen (je IP-Adresse: ab 5 Fehlern 5 Minuten, danach länger)
 *  - Zweiter Faktor: 6-stelliger Code aus einer Authenticator-App (TOTP, RFC 6238), dazu 8 Notfall-Codes
 * Daten in storage/auth.json (storage ist von außen gesperrt).
 */

function auth_file(): string { return storage() . '/auth.json'; }

function auth_read(): array
{
    $f = auth_file();
    $a = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
    return $a + ['totp' => '', 'pending' => '', 'recovery' => [], 'fails' => []];
}

function auth_write(array $a): void
{
    $f = auth_file();
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($a, JSON_UNESCAPED_SLASHES));
    @chmod($tmp, 0600);
    rename($tmp, $f);
}

function auth_ip(): string { return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '?'), 0, 64); }

/** Sekunden, die diese IP noch warten muss (0 = darf). */
function auth_locked(): int
{
    $a = auth_read();
    $f = $a['fails'][auth_ip()] ?? null;
    return $f && ($f['until'] ?? 0) > time() ? (int) $f['until'] - time() : 0;
}

function auth_fail(): void
{
    $a = auth_read();
    $ip = auth_ip();
    $f = $a['fails'][$ip] ?? ['n' => 0, 'until' => 0, 't' => 0];
    if (time() - (int) $f['t'] > 86400) {
        $f = ['n' => 0, 'until' => 0, 't' => 0];
    }
    $f['n']++;
    $f['t'] = time();
    if ($f['n'] >= 5) {
        $f['until'] = time() + min(3600, 300 * (2 ** min(4, $f['n'] - 5))); // 5, 10, 20, 40, 60 Minuten
    }
    $a['fails'][$ip] = $f;
    // alte Einträge aufräumen
    foreach ($a['fails'] as $k => $v) {
        if (time() - (int) ($v['t'] ?? 0) > 86400) {
            unset($a['fails'][$k]);
        }
    }
    auth_write($a);
}

function auth_ok(): void
{
    $a = auth_read();
    unset($a['fails'][auth_ip()]);
    auth_write($a);
}

// ---- TOTP
function b32_encode(string $bin): string
{
    $al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($bin) as $c) {
        $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= $al[bindec(str_pad($chunk, 5, '0'))];
    }
    return $out;
}

function b32_decode(string $s): string
{
    $al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $c) {
        $bits .= str_pad(decbin(strpos($al, $c)), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) === 8) {
            $out .= chr(bindec($chunk));
        }
    }
    return $out;
}

function totp_code(string $secret, int $step): string
{
    $h = hash_hmac('sha1', pack('N*', 0, $step), b32_decode($secret), true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}

function totp_check(string $secret, string $code): bool
{
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6 || $secret === '') {
        return false;
    }
    $t = intdiv(time(), 30);
    foreach ([-1, 0, 1] as $d) {
        if (hash_equals(totp_code($secret, $t + $d), $code)) {
            return true;
        }
    }
    return false;
}

/** Code aus der App oder ein noch unbenutzter Notfall-Code */
function auth_second_ok(string $code): bool
{
    $a = auth_read();
    if (totp_check($a['totp'], $code)) {
        return true;
    }
    $c = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
    foreach ($a['recovery'] as $i => $h) {
        if ($c !== '' && password_verify($c, $h)) {
            unset($a['recovery'][$i]);
            $a['recovery'] = array_values($a['recovery']);
            auth_write($a);
            return true;
        }
    }
    return false;
}

function auth_2fa_on(): bool { return auth_read()['totp'] !== ''; }
