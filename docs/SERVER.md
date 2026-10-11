# PDF-Stift on your own web server

With the server package you run PDF-Stift on your own web space – for example a subdomain like
`pdf.example.org`. Then you can use it in any browser (PC, iPad, Android) and with the Android app
in **Online** mode. Your PDFs and notes stay on *your* web space; nothing is sent anywhere else.

*(Deutsche Anleitung weiter unten.)*

## What you need

- Web space with **PHP 8.1 or newer** and the extensions `pdo_sqlite`, `mbstring`, `fileinfo`, `curl`, `zip`, `openssl`
  (almost every web host has these; Apache with `.htaccess` support is recommended)
- FTP (or SFTP) access
- Ideally its own (sub)domain with **HTTPS**, e.g. `pdf.example.org`

## Installation (about 10 minutes)

1. **Create a subdomain** in your hosting control panel, e.g. `pdf.example.org`, and switch on HTTPS (Let's Encrypt).
2. **Download** `pdf-stift-server-<version>.zip` from the [latest release](https://github.com/ek1-wq/pdf-stift/releases/latest) and unzip it.
3. **Upload** the *contents* of the folder `pdf-stift` with your FTP program into the folder of the subdomain.
   Make sure the hidden files `.htaccess` and `.user.ini` are uploaded too.
4. **Open** `https://pdf.example.org/` in your browser and **choose a password** (at least 8 characters).
   PDF-Stift creates `config.php` and the folder `storage/` itself – the web server needs write permission in this folder.
5. Done. Upload PDFs with “Upload PDF”, write on them, everything is saved automatically.

**Android app:** in the app choose **Online**, enter `https://pdf.example.org/` and your password.

## Updating

Download the new server package and upload it over the old files. **Do not overwrite** `config.php` and the
folder `storage/` – they contain your password and all your PDFs and notes.

## Security

- `storage/` and `config.php` are protected by `.htaccess`; PDF-Stift also puts its own `.htaccess` into `storage/`.
- Use HTTPS. In the settings you can switch on two-factor sign-in (authenticator app).
- Back up the folder `storage/` from time to time (e.g. via FTP).

---

# PDF-Stift auf dem eigenen Webserver

1. **Subdomain anlegen** im Kundenmenü Ihres Hosters, z. B. `pdf.ihre-domain.de`, und HTTPS (Let's Encrypt) einschalten.
2. `pdf-stift-server-<Version>.zip` aus dem [neuesten Release](https://github.com/ek1-wq/pdf-stift/releases/latest) **herunterladen** und entpacken.
3. Den **Inhalt** des Ordners `pdf-stift` per **FTP** in den Ordner der Subdomain hochladen – auch die versteckten Dateien `.htaccess` und `.user.ini`.
4. `https://pdf.ihre-domain.de/` im Browser **öffnen** und ein **Passwort festlegen** (mindestens 8 Zeichen).
5. Fertig. In der **Android-App** „Online“ wählen, die Adresse und das Passwort eintragen.

**Aktualisieren:** neues Paket hochladen, dabei `config.php` und den Ordner `storage/` **nicht** überschreiben.
Voraussetzung: PHP ab 8.1 mit `pdo_sqlite`, `mbstring`, `fileinfo`, `curl`, `zip`, `openssl` (bei fast allen Hostern vorhanden).
