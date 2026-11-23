#!/usr/bin/env python3
"""Email the FoundReach daily report.

    python3 send_report.py automation/work/2026-11-22/report.html --date 2026-11-22
    python3 send_report.py report.html --print        # show the message, send nothing

Standard library only; runs on Python 3.9 and later.

Settings, from the environment:
    SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
    REPORT_FROM (default SMTP_USER), REPORT_TO (comma-separated)
    SMTP_SECURITY   auto (default: implicit TLS on 465, STARTTLS otherwise), ssl, starttls,
                    or none (plain; for a local test server only)

Exit status: 0 sent (or printed), 2 not configured, 1 anything else.
The password is never printed, also not in error messages.
"""
import argparse
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from html.parser import HTMLParser


def log(text):
    print('send_report: ' + text, flush=True)


# ---- make the HTML safe to send -----------------------------------------------------------------
BLOCKS = re.compile(r'<(script|iframe|object|embed|form|noscript|svg)\b.*?</\1\s*>', re.S | re.I)
SINGLE = re.compile(r'<(script|iframe|object|embed|link|base|input|button|form|meta\s+http-equiv)\b[^>]*>', re.I)
REMOTE_IMG = re.compile(r'<img\b[^>]*>', re.I)
HANDLERS = re.compile(r'''\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)''', re.I)
JS_URL = re.compile(r'''(href|src)\s*=\s*(["']?)\s*(javascript|data|vbscript):[^"'>\s]*\2''', re.I)


def clean_html(html):
    """Removes what a report must not contain: scripts, frames, forms, images, event handlers."""
    before = len(html)
    html = BLOCKS.sub('', html)
    html = SINGLE.sub('', html)
    html = REMOTE_IMG.sub('', html)
    html = HANDLERS.sub('', html)
    html = JS_URL.sub(r'\1="#"', html)
    return html, before - len(html)


# ---- plain-text alternative ---------------------------------------------------------------------
class TextMaker(HTMLParser):
    BREAK = {'p', 'div', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'br', 'hr', 'pre'}
    SKIP = {'style', 'script', 'head', 'title'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.href = [], 0, None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        elif tag in self.BREAK: self.out.append('\n')
        elif tag == 'li': self.out.append('\n- ')
        elif tag in ('td', 'th'): self.out.append(' ')
        elif tag == 'a': self.href = dict(attrs).get('href')

    def handle_endtag(self, tag):
        if tag in self.SKIP: self.skip = max(0, self.skip - 1)
        elif tag in ('p', 'h1', 'h2', 'h3', 'h4', 'table', 'ul', 'ol'): self.out.append('\n')
        elif tag == 'a':
            if self.href and self.href.startswith('http') and self.href not in ''.join(self.out[-3:]):
                self.out.append(' (' + self.href + ')')
            self.href = None

    def handle_data(self, data):
        if not self.skip: self.out.append(re.sub(r'\s+', ' ', data))


def to_text(html):
    maker = TextMaker()
    maker.feed(html)
    text = ''.join(maker.out)
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n[ \t]+', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return text or 'The FoundReach daily report is in the HTML part of this message.'


# ---- message and delivery -----------------------------------------------------------------------
def build_message(html, date, sender, recipients, subject=''):
    msg = EmailMessage()
    msg['Subject'] = subject or 'FoundReach daily report – ' + date
    # A named sender reads as a person-run mailbox rather than a bare address.
    msg['From'] = sender if '<' in sender else formataddr(('FoundReach Reports', sender))
    msg['To'] = ', '.join(recipients)
    msg['Date'] = formatdate(localtime=False)
    domain = sender.rsplit('@', 1)[-1].strip('> ') if '@' in sender else None
    msg['Message-ID'] = make_msgid(domain=domain) if domain else make_msgid()
    msg.set_content(to_text(html), subtype='plain', charset='utf-8')
    msg.add_alternative(html, subtype='html', charset='utf-8')
    return msg


def scrub(text, secrets):
    text = str(text)
    for s in secrets:
        if s: text = text.replace(s, '***')
    return text[:400]


def send(msg, recipients, host, port, user, password, security):
    if security == 'auto':
        security = 'ssl' if port == 465 else 'starttls'
    context = ssl.create_default_context()
    if security == 'ssl':
        server = smtplib.SMTP_SSL(host, port, timeout=30, context=context)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
    try:
        server.ehlo()
        if security == 'starttls':
            if not server.has_extn('starttls'):
                raise RuntimeError('the server does not offer STARTTLS; refusing to send credentials in the clear')
            server.starttls(context=context)
            server.ehlo()
        if user:
            server.login(user, password)
        server.send_message(msg, to_addrs=recipients)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description='Email the FoundReach daily report.')
    parser.add_argument('html_file')
    parser.add_argument('--date', default='')
    parser.add_argument('--subject', default='', help='subject line; the default is the daily report subject')
    parser.add_argument('--print', dest='show', action='store_true', help='print the message instead of sending it')
    args = parser.parse_args()

    try:
        with open(args.html_file, encoding='utf-8', errors='replace') as f:
            html = f.read()
    except OSError as e:
        log('cannot read the report: ' + str(e)); return 1
    if len(html) > 1500000:
        log('the report is larger than 1.5 MB; not sending'); return 1
    html, removed = clean_html(html)
    if removed:
        log('removed %d characters of markup that does not belong in an email' % removed)

    env = os.environ.get
    host = env('SMTP_HOST', '').strip()
    user = env('SMTP_USER', '').strip()
    password = env('SMTP_PASS', '')
    sender = (env('REPORT_FROM', '') or user).strip()
    recipients = [a.strip() for a in env('REPORT_TO', '').split(',') if a.strip()]
    security = (env('SMTP_SECURITY', '') or 'auto').strip().lower()
    date = args.date or os.path.basename(os.path.dirname(os.path.abspath(args.html_file)))

    if args.show:
        msg = build_message(html, date, sender or 'report@localhost', recipients or ['founder@localhost'], args.subject)
        sys.stdout.write(msg.as_string()[:6000] + '\n'); return 0

    missing = [n for n, v in (('SMTP_HOST', host), ('REPORT_TO', recipients), ('REPORT_FROM or SMTP_USER', sender)) if not v]
    if missing:
        log('not configured (' + ', '.join(missing) + ' missing); nothing was sent'); return 2
    try:
        port = int(env('SMTP_PORT', '') or 587)
    except ValueError:
        log('SMTP_PORT is not a number'); return 2
    if security not in ('auto', 'ssl', 'starttls', 'none'):
        log('SMTP_SECURITY must be auto, ssl, starttls or none'); return 2
    if security == 'none' and host not in ('127.0.0.1', 'localhost', '::1'):
        log('SMTP_SECURITY=none is only allowed for a local test server'); return 2

    msg = build_message(html, date, sender, recipients, args.subject)
    try:
        send(msg, recipients, host, port, user, password, security)
    except Exception as e:  # the cause is reported without the password
        log('sending failed: %s: %s' % (type(e).__name__, scrub(e, [password])))
        return 1
    log('sent "%s" to %s through %s:%d' % (msg['Subject'], ', '.join(recipients), host, port))
    return 0


if __name__ == '__main__':
    sys.exit(main())
