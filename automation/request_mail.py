#!/usr/bin/env python3
"""Build the short "the CEO agent needs something from you" email.

    python3 request_mail.py requests.txt --date 2026-11-23 --out request.html --seen memory/requests-sent.txt

requests.txt has one request per line: `what is needed | why | how to provide it`.
A request that was mailed in the last three days is left out, so the same ask is not sent nightly.
Prints the number of requests in the email; writes no file when that number is 0.
At most five requests, each cut to a sentence or two: the email reads in under a minute.
Standard library only.
"""
import argparse
import datetime
import html
import re
import sys

MAX_ITEMS, REPEAT_DAYS = 5, 3


def clip(text, n):
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= n else text[:n - 1].rstrip() + '…'


def linked(text):
    """Escapes the text and makes https links clickable."""
    out, last = [], 0
    for m in re.finditer(r'https://[^\s<>"\')]+', text):
        out.append(html.escape(text[last:m.start()]))
        url = html.escape(m.group(0), quote=True)
        out.append('<a href="%s" style="color:#34490f;text-decoration:underline">%s</a>' % (url, url))
        last = m.end()
    out.append(html.escape(text[last:]))
    return ''.join(out)


def read_requests(path):
    items = []
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip().lstrip('-').strip()
        if not line or line.startswith('#'): continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts[0]) < 8: continue
        parts += ['', '']
        items.append((clip(parts[0], 140), clip(parts[1], 220), clip(parts[2], 220)))
    return items


def key(what):
    return re.sub(r'[^a-z0-9]+', ' ', what.lower()).strip()[:80]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('requests'); p.add_argument('--date', required=True)
    p.add_argument('--out', required=True); p.add_argument('--seen', default='')
    a = p.parse_args()
    today = datetime.date.fromisoformat(a.date)
    seen = {}
    if a.seen:
        try:
            for line in open(a.seen, encoding='utf-8'):
                d, _, k = line.strip().partition('|')
                try: seen[k] = max(seen.get(k, datetime.date.min), datetime.date.fromisoformat(d))
                except ValueError: pass
        except FileNotFoundError:
            pass
    items, used = [], set()
    for what, why, how in read_requests(a.requests):
        k = key(what)
        if k in used or (k in seen and (today - seen[k]).days < REPEAT_DAYS): continue
        used.add(k); items.append((what, why, how))
    items = items[:MAX_ITEMS]
    if not items:
        print(0); return 0

    label = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#59645a;font-weight:bold'
    rows = []
    for i, (what, why, how) in enumerate(items, 1):
        rows.append(
            '<tr><td style="padding:0 24px 12px"><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
            'style="border:1px solid #e3e7dc;border-left:4px solid #c9f15a;background:#ffffff"><tr><td style="padding:14px 16px">'
            '<div style="font-size:16px;font-weight:bold;color:#222923;margin:0 0 6px">%d. %s</div>%s%s</td></tr></table></td></tr>' % (
                i, linked(what),
                '<div style="margin:0 0 6px"><span style="%s">Why</span><br>%s</div>' % (label, linked(why)) if why else '',
                '<div><span style="%s">What to do</span><br>%s</div>' % (label, linked(how)) if how else ''))
    count = '%d request%s' % (len(items), '' if len(items) == 1 else 's')
    page = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>FoundReach request</title></head>'
        '<body style="margin:0;padding:0;background:#f6f7f3;font-family:-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#222923;font-size:15px;line-height:1.5">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f3"><tr><td align="center" style="padding:16px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#f6f7f3">'
        '<tr><td style="background:#202a31;color:#f3f5ee;padding:22px 24px">'
        '<div style="font-size:13px;letter-spacing:3px;font-weight:bold;color:#c9f15a">FOUNDREACH</div>'
        '<div style="font-size:22px;font-weight:bold;margin:8px 0 2px">The CEO agent needs you</div>'
        '<div style="color:#b9c2b5">' + html.escape(today.strftime('%d %B %Y')) + ' · ' + count + ' · one minute</div></td></tr>'
        '<tr><td style="padding:18px 24px 12px">The team is blocked on the following and cannot get it on its own. Reply to this email with what is asked.</td></tr>'
        + ''.join(rows) +
        '<tr><td style="padding:6px 24px 22px;color:#59645a;font-size:13px">Everything else was decided by the CEO, product and CTO agents; see today\'s report. '
        'A request is repeated after three days if it is still open.</td></tr>'
        '</table></td></tr></table></body></html>')
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(page)
    if a.seen:
        with open(a.seen, 'a', encoding='utf-8') as f:
            for what, _, _ in items:
                f.write('%s|%s\n' % (a.date, key(what)))
    print(len(items)); return 0


if __name__ == '__main__':
    sys.exit(main())
