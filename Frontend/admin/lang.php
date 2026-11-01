<?php
declare(strict_types=1);

/*
 * Admin page translations. The language follows ?lang=, then the rm_lang
 * cookie set by the main website, then the browser's Accept-Language.
 */

const ADMIN_LANGUAGES = [
    'en' => 'English',
    'nb' => 'Norsk',
    'sv' => 'Svenska',
    'de' => 'Deutsch',
];

const ADMIN_STRINGS = [
    'en' => [
        'title' => 'Service admin',
        'subtitle' => 'Mark active technical faults as reported to external service.',
        'back' => 'Back to status page',
        'logout' => 'Log out',
        'login' => 'Log in',
        'username' => 'Username',
        'password' => 'Password',
        'blocked' => 'Too many failed attempts. Login is temporarily blocked.',
        'logged_in' => 'Logged in.',
        'bad_login' => 'Wrong username or password.',
        'bad_csrf' => 'Invalid security token. Reload the page and try again.',
        'not_logged_in' => 'Not logged in.',
        'bad_id' => 'Invalid incident ID.',
        'reported_ok' => 'The incident is marked as reported to service.',
        'reported_fail' => 'The incident could not be updated. It may already be resolved.',
        'cleared' => 'The service mark was removed.',
        'intro' => '{count} active technical incidents. When the logger resolves an incident, its service history is kept automatically.',
        'none' => 'No active technical incidents. 🎉',
        'reported_pill' => 'Reported to service',
        'opened' => 'Opened {time}',
        'active_for' => 'Active for {duration}',
        'reported_at' => 'Reported {time}',
        'note' => 'Note',
        'note_hint' => '(shown publicly on the status page – no names or phone numbers)',
        'note_placeholder' => 'E.g. Reported to Ricoh – waiting for technician.',
        'save_note' => 'Save note',
        'clear_service' => 'Remove service mark',
        'report_service' => 'Mark as reported to service',
        'not_configured' => 'The admin page is not configured yet. Create admin/config.php (see config.example.php) or set ADMIN_USERNAME and ADMIN_PASSWORD_HASH, and configure the database.',
        'severity_critical' => 'Critical',
        'severity_warning' => 'Warning',
        'severity_other' => 'Other',
        'language' => 'Language',
    ],
    'nb' => [
        'title' => 'Service-admin',
        'subtitle' => 'Merk aktive tekniske feil som meldt til ekstern service.',
        'back' => 'Tilbake til statussiden',
        'logout' => 'Logg ut',
        'login' => 'Logg inn',
        'username' => 'Brukernavn',
        'password' => 'Passord',
        'blocked' => 'For mange mislykkede forsøk. Innlogging er midlertidig sperret.',
        'logged_in' => 'Innlogget.',
        'bad_login' => 'Feil brukernavn eller passord.',
        'bad_csrf' => 'Ugyldig sikkerhetstoken. Last siden på nytt og prøv igjen.',
        'not_logged_in' => 'Ikke innlogget.',
        'bad_id' => 'Ugyldig hendelses-ID.',
        'reported_ok' => 'Hendelsen er markert som meldt til service.',
        'reported_fail' => 'Hendelsen kunne ikke oppdateres. Den kan allerede være løst.',
        'cleared' => 'Service-markeringen er fjernet.',
        'intro' => '{count} aktive tekniske hendelser. Når loggeren løser en hendelse, beholdes servicehistorikken automatisk.',
        'none' => 'Ingen aktive tekniske hendelser. 🎉',
        'reported_pill' => 'Meldt til service',
        'opened' => 'Oppstod {time}',
        'active_for' => 'Aktiv i {duration}',
        'reported_at' => 'Meldt {time}',
        'note' => 'Notat',
        'note_hint' => '(vises offentlig på statussiden – ikke skriv navn eller telefonnumre)',
        'note_placeholder' => 'F.eks. Meldt til Ricoh – avventer tekniker.',
        'save_note' => 'Lagre notat',
        'clear_service' => 'Fjern service-markering',
        'report_service' => 'Merk som meldt til service',
        'not_configured' => 'Admin-siden er ikke ferdig konfigurert. Lag admin/config.php (se config.example.php) eller sett ADMIN_USERNAME og ADMIN_PASSWORD_HASH, og konfigurer databasen.',
        'severity_critical' => 'Kritisk',
        'severity_warning' => 'Advarsel',
        'severity_other' => 'Annet',
        'language' => 'Språk',
    ],
    'sv' => [
        'title' => 'Serviceadmin',
        'subtitle' => 'Markera aktiva tekniska fel som anmälda till extern service.',
        'back' => 'Tillbaka till statussidan',
        'logout' => 'Logga ut',
        'login' => 'Logga in',
        'username' => 'Användarnamn',
        'password' => 'Lösenord',
        'blocked' => 'För många misslyckade försök. Inloggning är tillfälligt spärrad.',
        'logged_in' => 'Inloggad.',
        'bad_login' => 'Fel användarnamn eller lösenord.',
        'bad_csrf' => 'Ogiltig säkerhetstoken. Ladda om sidan och försök igen.',
        'not_logged_in' => 'Inte inloggad.',
        'bad_id' => 'Ogiltigt händelse-ID.',
        'reported_ok' => 'Händelsen är markerad som anmäld till service.',
        'reported_fail' => 'Händelsen kunde inte uppdateras. Den kan redan vara löst.',
        'cleared' => 'Servicemarkeringen togs bort.',
        'intro' => '{count} aktiva tekniska händelser. När loggern löser en händelse sparas servicehistoriken automatiskt.',
        'none' => 'Inga aktiva tekniska händelser. 🎉',
        'reported_pill' => 'Anmäld till service',
        'opened' => 'Uppstod {time}',
        'active_for' => 'Aktiv i {duration}',
        'reported_at' => 'Anmäld {time}',
        'note' => 'Anteckning',
        'note_hint' => '(visas offentligt på statussidan – skriv inga namn eller telefonnummer)',
        'note_placeholder' => 'T.ex. Anmäld till Ricoh – väntar på tekniker.',
        'save_note' => 'Spara anteckning',
        'clear_service' => 'Ta bort servicemarkering',
        'report_service' => 'Markera som anmäld till service',
        'not_configured' => 'Adminsidan är inte konfigurerad. Skapa admin/config.php (se config.example.php) eller sätt ADMIN_USERNAME och ADMIN_PASSWORD_HASH, och konfigurera databasen.',
        'severity_critical' => 'Kritisk',
        'severity_warning' => 'Varning',
        'severity_other' => 'Övrigt',
        'language' => 'Språk',
    ],
    'de' => [
        'title' => 'Service-Admin',
        'subtitle' => 'Aktive technische Störungen als an den externen Service gemeldet markieren.',
        'back' => 'Zurück zur Statusseite',
        'logout' => 'Abmelden',
        'login' => 'Anmelden',
        'username' => 'Benutzername',
        'password' => 'Passwort',
        'blocked' => 'Zu viele fehlgeschlagene Versuche. Die Anmeldung ist vorübergehend gesperrt.',
        'logged_in' => 'Angemeldet.',
        'bad_login' => 'Falscher Benutzername oder falsches Passwort.',
        'bad_csrf' => 'Ungültiges Sicherheitstoken. Seite neu laden und erneut versuchen.',
        'not_logged_in' => 'Nicht angemeldet.',
        'bad_id' => 'Ungültige Ereignis-ID.',
        'reported_ok' => 'Das Ereignis ist als an den Service gemeldet markiert.',
        'reported_fail' => 'Das Ereignis konnte nicht aktualisiert werden. Es ist möglicherweise bereits behoben.',
        'cleared' => 'Die Service-Markierung wurde entfernt.',
        'intro' => '{count} aktive technische Ereignisse. Wenn der Logger ein Ereignis schließt, bleibt der Serviceverlauf automatisch erhalten.',
        'none' => 'Keine aktiven technischen Ereignisse. 🎉',
        'reported_pill' => 'An Service gemeldet',
        'opened' => 'Aufgetreten {time}',
        'active_for' => 'Aktiv seit {duration}',
        'reported_at' => 'Gemeldet {time}',
        'note' => 'Notiz',
        'note_hint' => '(öffentlich auf der Statusseite sichtbar – keine Namen oder Telefonnummern)',
        'note_placeholder' => 'Z. B. An Ricoh gemeldet – warte auf Techniker.',
        'save_note' => 'Notiz speichern',
        'clear_service' => 'Service-Markierung entfernen',
        'report_service' => 'Als an Service gemeldet markieren',
        'not_configured' => 'Die Admin-Seite ist noch nicht eingerichtet. admin/config.php anlegen (siehe config.example.php) oder ADMIN_USERNAME und ADMIN_PASSWORD_HASH setzen und die Datenbank konfigurieren.',
        'severity_critical' => 'Kritisch',
        'severity_warning' => 'Warnung',
        'severity_other' => 'Sonstiges',
        'language' => 'Sprache',
    ],
];

function admin_language(): string
{
    static $lang = null;
    if ($lang !== null) {
        return $lang;
    }

    $requested = strtolower((string) ($_GET['lang'] ?? ''));
    if (isset(ADMIN_LANGUAGES[$requested])) {
        setcookie('rm_lang', $requested, [
            'expires' => time() + 365 * 86400,
            'path' => '/',
            'samesite' => 'Lax',
        ]);
        return $lang = $requested;
    }

    $cookie = strtolower((string) ($_COOKIE['rm_lang'] ?? ''));
    if (isset(ADMIN_LANGUAGES[$cookie])) {
        return $lang = $cookie;
    }

    foreach (explode(',', (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) as $part) {
        $code = strtolower(substr(trim($part), 0, 2));
        if ($code === 'no' || $code === 'nn') {
            $code = 'nb';
        }
        if (isset(ADMIN_LANGUAGES[$code])) {
            return $lang = $code;
        }
    }

    return $lang = 'en';
}

function t(string $key, array $vars = []): string
{
    $text = ADMIN_STRINGS[admin_language()][$key] ?? ADMIN_STRINGS['en'][$key] ?? $key;
    foreach ($vars as $name => $value) {
        $text = str_replace('{' . $name . '}', (string) $value, $text);
    }
    return $text;
}
