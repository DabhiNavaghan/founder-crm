#!/usr/bin/env python3
"""Collect US startup data for FoundReach.

Stage 1  yc     - public Y Combinator directory: company profile + founders.
Stage 2  sites  - each company's own website: contact/hiring email, careers page, contact page.
Stage 3  build  - merge everything into out/companies.json.

Everything is cached on disk, so the script can be stopped and re-run.
Only publicly listed information is collected; emails are never guessed.

Usage: python3 scrape.py yc|sites|build|all [--limit N]
"""
import html, json, os, re, ssl, sys, time, random, gzip, zlib
import urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'cache')
OUT = os.path.join(ROOT, 'out')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
YC_INDEX = 'https://yc-oss.github.io/api/companies/all.json'
TOPSTARTUPS = 'https://topstartups.io/'

CTX = ssl.create_default_context()
LOOSE = ssl.create_default_context(); LOOSE.check_hostname = False; LOOSE.verify_mode = ssl.CERT_NONE


def fetch(url, timeout=15, limit=1_500_000, strict=True):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.5',
                                               'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'gzip, deflate'})
    try:
        r = urllib.request.urlopen(req, timeout=timeout, context=CTX if strict else LOOSE)
    except urllib.error.HTTPError as e:
        e.close()   # an error reply holds its connection open until it is closed; thousands of them run out of file handles
        raise
    with r:
        raw = r.read(limit)
        enc = (r.headers.get('Content-Encoding') or '').lower()
        try:
            if enc == 'gzip': raw = zlib.decompressobj(31).decompress(raw)
            elif enc == 'deflate': raw = zlib.decompressobj().decompress(raw)
        except Exception:
            pass
        ctype = r.headers.get('Content-Type') or ''
        m = re.search(r'charset=([\w-]+)', ctype)
        try:
            text = raw.decode(m.group(1) if m else 'utf-8', 'replace')
        except LookupError:
            text = raw.decode('utf-8', 'replace')
        return r.geturl(), text


def load(path, default=None):
    try:
        with open(path) as f: return json.load(f)
    except Exception:
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f: json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


# ---------------------------------------------------------------- stage 1: YC
def yc_index():
    path = os.path.join(CACHE, 'yc_all.json')
    data = load(path)
    if not data:
        _, text = fetch(YC_INDEX, timeout=90, limit=50_000_000)
        data = json.loads(text); save(path, data)
    return [c for c in data if 'United States of America' in (c.get('regions') or []) and c.get('status') in ('Active', 'Public')]


def yc_company(c):
    path = os.path.join(CACHE, 'yc', c['slug'] + '.json')
    if os.path.exists(path): return 'cached'
    for attempt in range(5):
        try:
            _, text = fetch(c['url'], timeout=25, limit=3_000_000)
            m = re.search(r'data-page="([^"]+)"', text)
            if not m: raise ValueError('no data-page')
            props = json.loads(html.unescape(m.group(1)))['props']
            co = props.get('company') or {}
            save(path, {
                'slug': c['slug'], 'location': co.get('location'), 'city': co.get('city'), 'country': co.get('country'),
                'linkedin_url': co.get('linkedin_url'), 'twitter_url': co.get('twitter_url'), 'year_founded': co.get('year_founded'),
                'jobs': len(props.get('jobPostings') or []),
                'founders': [{'name': f.get('full_name'), 'title': f.get('title'), 'linkedin_url': f.get('linkedin_url'),
                              'twitter_url': f.get('twitter_url'), 'active': f.get('is_active')} for f in co.get('founders') or []],
            })
            time.sleep(0.25 + random.random() * 0.35)
            return 'ok'
        except urllib.error.HTTPError as e:
            if e.code == 404:
                save(path, {'slug': c['slug'], 'missing': True, 'founders': []}); return '404'
            time.sleep(4 * (attempt + 1) + random.random() * 3)
        except Exception:
            time.sleep(2 * (attempt + 1))
    return 'fail'


# ---------------------------------------------------------------- stage 2: websites
EMAIL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}')
BAD_EMAIL = re.compile(r'\.(png|jpe?g|gif|svg|webp|avif|css|js|woff2?|ttf|mp4)$|@(\d+x|sentry|example|domain|email|yourcompany|company|mail|test|site|your)\b|wixpress|sentry\.io|@2x|godaddy|u003e|noreply|no-reply|donotreply|@email\.com|@domain\.com|john@|jane@|johndoe|janedoe|john\.doe|jane\.doe|name@|you@|user@|username@|firstname|yourname|your-email|your\.email', re.I)
HIRING = re.compile(r'^(careers?|jobs?|hiring|talent|recruit\w*|hr|people|join\w*|work|apply|resumes?|cv)[\w.+-]*@', re.I)
GENERAL = ['hello', 'hi', 'contact', 'info', 'team', 'founders', 'support', 'help', 'sales', 'hey', 'inquiries', 'enquiries', 'office', 'partnerships', 'press', 'media']
CAREER_HOSTS = re.compile(r'(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|breezy\.hr|bamboohr\.com|ats\.rippling\.com|wellfound\.com|angel\.co|workatastartup\.com|notion\.site|recruitee\.com|smartrecruiters\.com|gem\.com|dover\.com|teamtailor\.com|pinpointhq\.com|jobvite\.com|myworkdayjobs\.com|icims\.com|polymer\.co|gusto\.com/boards|careers-page\.com|applytojob\.com)', re.I)
CAREER_PATH = re.compile(r'(career|/jobs?(/|$|\?|#)|join-?us|join-?the-?team|joinus|work-?with-?us|we-?are-?hiring|open-?(roles|positions)|/join(/|$))', re.I)
CAREER_TEXT = re.compile(r"^\s*(careers?|jobs?|join( us| the team| our team)?|we'?re hiring|hiring|work with us|open (roles|positions))\b", re.I)
CONTACT_PATH = re.compile(r'(/contact|contact-?us|get-?in-?touch|/support(/|$)|/talk-to|/demo)', re.I)
LINK = re.compile(r'<a\b[^>]*?href\s*=\s*["\']?([^"\'\s>]+)[^>]*>(.*?)</a>', re.I | re.S)
TAG = re.compile(r'<[^>]+>')


def cf_decode(s):
    try:
        k = int(s[:2], 16)
        return ''.join(chr(int(s[i:i + 2], 16) ^ k) for i in range(2, len(s), 2))
    except Exception:
        return ''


def emails_in(text):
    found = []
    for enc in re.findall(r'data-cfemail="([0-9a-fA-F]+)"', text): found.append(cf_decode(enc))
    for enc in re.findall(r'/cdn-cgi/l/email-protection#([0-9a-fA-F]+)', text): found.append(cf_decode(enc))
    for m in re.findall(r'mailto:([^"\'?\s>&]+)', text, re.I): found.append(urllib.parse.unquote(html.unescape(m)))
    body = re.sub(r'<(script|style)\b.*?</\1>', ' ', text, flags=re.S | re.I)
    found += EMAIL.findall(html.unescape(body))
    out = []
    for e in found:
        e = e.strip().strip('.,;:').lower()
        if not EMAIL.fullmatch(e) or BAD_EMAIL.search(e) or len(e) > 80: continue
        if e not in out: out.append(e)
    return out


def base_domain(host):
    host = (host or '').lower().split(':')[0]
    if host.startswith('www.'): host = host[4:]
    return host


def site_scan(website):
    """Return what the company's own site publicly lists."""
    res = {'emails': [], 'careers_url': '', 'contact_url': '', 'linkedin_url': '', 'ok': False}
    url = website if re.match(r'https?://', website) else 'https://' + website
    try:
        try:
            final, text = fetch(url, timeout=14)
        except (ssl.SSLError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError): raise
            final, text = fetch(url, timeout=14, strict=False)
    except Exception as e:
        res['error'] = type(e).__name__ + ':' + str(getattr(e, 'code', ''))
        return res
    res['ok'] = True
    host = base_domain(urllib.parse.urlparse(final).netloc)
    pages = [(final, text)]
    career, contact = [], []
    for href, inner in LINK.findall(text):
        href = html.unescape(href)
        if href.startswith(('mailto:', 'tel:', 'javascript:', '#')): continue
        full = urllib.parse.urljoin(final, href)
        p = urllib.parse.urlparse(full)
        if p.scheme not in ('http', 'https'): continue
        label = html.unescape(TAG.sub(' ', inner)).strip()[:60]
        h = base_domain(p.netloc)
        same = h == host or h.endswith('.' + host)
        if not res['linkedin_url'] and 'linkedin.com/company/' in full: res['linkedin_url'] = full.split('?')[0]
        if CAREER_HOSTS.search(full) or (same and CAREER_PATH.search(p.path)) or (CAREER_TEXT.search(label) and (same or CAREER_HOSTS.search(full) or re.match(r'(jobs|careers)\.', h))):
            career.append(full)
        elif same and CONTACT_PATH.search(p.path):
            contact.append(full)
    if career: res['careers_url'] = career[0]
    if contact:
        best = [c for c in contact if 'contact' in c.lower()]
        res['contact_url'] = (best or contact)[0]
    extra = []
    if res['contact_url']: extra.append(res['contact_url'])
    else: extra.append(urllib.parse.urljoin(final, '/contact'))
    if res['careers_url'] and base_domain(urllib.parse.urlparse(res['careers_url']).netloc).endswith(host): extra.append(res['careers_url'])
    for u in extra[:2]:
        if u.rstrip('/') == final.rstrip('/'): continue
        try:
            f2, t2 = fetch(u, timeout=10, limit=800_000)
            pages.append((f2, t2))
            if not res['contact_url'] and u.endswith('/contact') and '/contact' in f2: res['contact_url'] = f2
        except Exception:
            pass
    seen = []
    for _, t in pages:
        for e in emails_in(t):
            if e not in seen: seen.append(e)
    res['emails'] = seen[:25]
    res['host'] = host
    return res


def pick_emails(emails, host):
    """Split a site's public addresses into (general contact, hiring). Company-domain addresses only win."""
    emails = [e for e in emails if not BAD_EMAIL.search(e)]
    def own(e):
        d = e.split('@')[1]
        return d == host or d.endswith('.' + host) or host.endswith('.' + d)
    mine = [e for e in emails if own(e)]
    hiring = next((e for e in mine if HIRING.search(e)), '')
    general = ''
    locals_ = {e.split('@')[0]: e for e in mine if not HIRING.search(e)}
    for g in GENERAL:
        if g in locals_: general = locals_[g]; break
    if not general:
        rest = [e for e in mine if not HIRING.search(e) and not re.match(r'(privacy|legal|security|abuse|dpo|gdpr|billing|compliance|unsubscribe|notifications?)@', e)]
        if rest: general = rest[0]
    if not general:
        general = next((e for e in mine if re.match(r'(privacy|legal|dpo|gdpr|compliance|security)@', e)), '')
    if not general and not hiring:
        other = [e for e in emails if not own(e) and re.search(r'@(gmail|outlook|hotmail|yahoo|proton(mail)?|icloud|hey)\.', e)]
        if other: general = other[0]
    return general, hiring


def site_job(key, website):
    path = os.path.join(CACHE, 'sites', key + '.json')
    if os.path.exists(path): return 'cached'
    res = site_scan(website)
    save(path, res)
    return 'ok' if res['ok'] else 'fail'


# ---------------------------------------------------------------- stage 2b: deeper pass for whatever is still missing
ICON = re.compile(r'<link\b[^>]*rel=["\']?([^"\'>]*icon[^"\'>]*)["\']?[^>]*>', re.I)
OG = re.compile(r'<meta\b[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)', re.I)


def page_ok(base, path, soft_len):
    """Fetch base+path; return (final_url, text) only if it is a real page, not a redirect home or a catch-all."""
    try:
        final, text = fetch(urllib.parse.urljoin(base, path), timeout=10, limit=800_000, strict=False)
    except Exception:
        return None
    if urllib.parse.urlparse(final).path.rstrip('/') == '': return None
    if soft_len is not None and abs(len(text) - soft_len) < max(200, soft_len * 0.03): return None
    return final, text


def ats_probe(slug):
    if len(slug) < 5: return ''
    probes = [('https://api.ashbyhq.com/posting-api/job-board/' + slug, 'https://jobs.ashbyhq.com/' + slug, lambda d: d.get('jobs')),
              ('https://boards-api.greenhouse.io/v1/boards/' + slug + '/jobs', 'https://boards.greenhouse.io/' + slug, lambda d: d.get('jobs')),
              ('https://api.lever.co/v0/postings/' + slug + '?mode=json&limit=1', 'https://jobs.lever.co/' + slug, lambda d: isinstance(d, list) and d)]
    for api, board, has in probes:
        try:
            _, text = fetch(api, timeout=8, limit=300_000)
            if has(json.loads(text)): return board
        except Exception:
            pass
    return ''


def deep_job(key, website, need):
    path = os.path.join(CACHE, 'deep', key + '.json')
    if os.path.exists(path): return 'cached'
    res = {'emails': [], 'contact_url': '', 'careers_url': '', 'logo_url': ''}
    url = website if re.match(r'https?://', website) else 'https://' + website
    try:
        base, home = fetch(url, timeout=14, strict=False)
    except Exception as e:
        save(path, res); return 'fail'
    host = base_domain(urllib.parse.urlparse(base).netloc)
    soft = None
    try:
        _, junk = fetch(urllib.parse.urljoin(base, '/zz-no-such-page-7q1x'), timeout=8, limit=800_000, strict=False)
        soft = len(junk)
    except Exception:
        pass
    if 'logo' in need:
        icons = [(rel.lower(), re.search(r'href=["\']?([^"\'\s>]+)', tag)) for tag, rel in ((m.group(0), m.group(1)) for m in ICON.finditer(home))]
        icons = [(rel, h.group(1)) for rel, h in icons if h]
        best = next((h for rel, h in icons if 'apple-touch' in rel), '') or next((h for rel, h in icons), '')
        og = OG.search(home)
        pick = best or (og.group(1) if og else '') or '/favicon.ico'
        res['logo_url'] = urllib.parse.urljoin(base, html.unescape(pick))
    texts = [home]
    if 'contact' in need or 'email' in need:
        for p in ['/contact', '/contact-us', '/contactus', '/company/contact', '/support', '/help', '/about/contact']:
            r = page_ok(base, p, soft)
            if r:
                texts.append(r[1])
                if not res['contact_url']: res['contact_url'] = r[0]
                if p != '/support': break
    if 'careers' in need:
        for p in ['/careers', '/jobs', '/company/careers', '/join-us', '/about/careers', '/join']:
            r = page_ok(base, p, soft)
            if r: res['careers_url'] = r[0]; texts.append(r[1]); break
        if not res['careers_url']: res['careers_url'] = ats_probe(host.split('.')[0])
    if 'email' in need:
        for p in ['/about', '/privacy', '/privacy-policy', '/terms', '/legal/privacy', '/company', '/team', '/.well-known/security.txt']:
            r = page_ok(base, p, soft)
            if r: texts.append(r[1])
            if r and any(e.split('@')[1].endswith(host) for e in emails_in(r[1])): break
    for t in texts:
        for e in emails_in(t):
            if e not in res['emails']: res['emails'].append(e)
    res['emails'] = res['emails'][:25]; res['host'] = host
    save(path, res)
    return 'ok'


def deep():
    cos = load(os.path.join(OUT, 'companies.json')) or []
    jobs = []
    for c in cos:
        if not c.get('website'): continue
        need = [k for k, miss in (('contact', not c['contact_url']), ('email', not c['contact_email']), ('careers', not c['careers_url'] or 'ycombinator.com' in c['careers_url']),
                                  ('logo', not c['logo_url'])) if miss]
        if need: jobs.append((site_key(c['website']), c['website'], need))
    print('deep pass for', len(jobs), 'companies', flush=True)
    run(jobs, deep_job, 24, 'deep')



# ---------------------------------------------------------------- topstartups (front page only; robots.txt disallows ?page=)
def topstartups():
    path = os.path.join(CACHE, 'topstartups.json')
    data = load(path)
    if data is not None: return data
    data = []
    try:
        _, text = fetch(TOPSTARTUPS, timeout=30)
        for card in text.split('infinite-item')[1:]:
            name = re.search(r'<h3[^>]*>([^<]+)', card)
            site = re.search(r'id="startup-website-link"|href="([^"]+)"', card)
            site = re.search(r'<a href="([^"]+)" target="_blank" id="startup-website-link"', card)
            logo = re.search(r'<img src="([^"]+)"', card)
            hq = re.search(r'HQ:\s*([^<\n]+)', card)
            desc = re.search(r'What they do: </b>\s*<br>([^<]+)', card)
            li = re.search(r'href=(https://www\.linkedin\.com/company/[^\s>]+)', card)
            jobs = re.search(r'href=(\S+) target="_blank" class="btn[^"]*" id="view-jobs"', card)
            tags = [t.strip() for t in re.findall(r'id="industry-tags">([^<]+)', card)]
            funding = [t.strip() for t in re.findall(r'id="funding-tags">([^<]+)', card)]
            if not name or not site: continue
            clean = lambda u: re.sub(r'[?&]utm_source=topstartups\.io', '', html.unescape(u)).rstrip('?')
            data.append({'name': html.unescape(name.group(1)).strip(), 'website': clean(site.group(1)), 'logo_url': logo.group(1) if logo else '',
                         'location': html.unescape(hq.group(1)).strip() if hq else '', 'description': html.unescape(desc.group(1)).strip() if desc else '',
                         'linkedin_url': li.group(1) if li else '', 'careers_url': clean(jobs.group(1)) if jobs else '', 'tags': tags, 'funding': funding})
    except Exception as e:
        print('topstartups failed', e)
    save(path, data)
    return data


# ---------------------------------------------------------------- runner
def run(jobs, fn, workers, label):
    done = {}; t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(fn, *j) for j in jobs]
        for i, f in enumerate(as_completed(futs), 1):
            try: r = f.result()
            except Exception as e:
                r = 'error'
                if done.get('error', 0) < 3: print(f'[{label}] job failed: {type(e).__name__}: {str(e)[:160]}', flush=True)
            done[r] = done.get(r, 0) + 1
            if i % 100 == 0 or i == len(futs):
                print(f'[{label}] {i}/{len(futs)} {done} {int(time.time() - t0)}s', flush=True)


def site_key(website):
    return re.sub(r'[^a-z0-9.-]', '_', base_domain(urllib.parse.urlparse(website if '://' in website else 'https://' + website).netloc))[:120]


PRIMARY = re.compile(r'\b(ceo|chief executive|founder|co-?founder|president|owner|managing director|product manager|head of product|cpo|chief product)\b', re.I)
SECONDARY = re.compile(r'\b(cto|chief technology|chief technical|engineer\w*|technical|head of (product|engineering|technology)|vp\b.*(eng|product)|architect|developer|chief scientist|chief product|cpo|product)\b', re.I)


def classify(title):
    t = title or ''
    if re.search(r'\b(ceo|chief executive|president)\b', t, re.I): return 'Primary'
    if SECONDARY.search(t): return 'Secondary'
    return 'Primary'


def build():
    companies = []
    for c in yc_index():
        d = load(os.path.join(CACHE, 'yc', c['slug'] + '.json')) or {}
        if d.get('country') and d['country'] != 'US': continue
        website = (c.get('website') or '').strip()
        s = load(os.path.join(CACHE, 'sites', site_key(website) + '.json')) if website else None
        s = s or {}
        dp = (load(os.path.join(CACHE, 'deep', site_key(website) + '.json')) if website else None) or {}
        s = dict(s)
        s['emails'] = list(dict.fromkeys((s.get('emails') or []) + (dp.get('emails') or [])))
        s['host'] = s.get('host') or dp.get('host')
        s['contact_url'] = s.get('contact_url') or dp.get('contact_url') or ''
        if not s.get('careers_url') and dp.get('careers_url'): s['careers_url'] = dp['careers_url']
        general, hiring = pick_emails(s.get('emails') or [], s.get('host') or base_domain(urllib.parse.urlparse(website).netloc)) if s.get('emails') else ('', '')
        careers = s.get('careers_url') or ''
        if re.search(r'rippling\.com/(?!.*jobs)|/blog/', careers): careers = ''
        if s.get('emails'): s['emails'] = [e for e in s['emails'] if not BAD_EMAIL.search(e)]
        if not careers and (c.get('isHiring') or d.get('jobs')): careers = c['url'] + '/jobs'
        host = s.get('host') or ''
        own_emails = [e for e in (s.get('emails') or []) if host and e.split('@')[1].endswith(host) and not BAD_EMAIL.search(e)]
        people = []
        for f in d.get('founders') or []:
            if not f.get('name'): continue
            li = (f.get('linkedin_url') or '').strip()
            if li and not re.match(r'https?://', li): li = 'https://' + li.lstrip('/')
            parts = re.sub(r'[^a-z ]', '', f['name'].lower()).split()
            mail = ''
            if parts:
                fn, ln = parts[0], parts[-1]
                wanted = {fn, fn + '.' + ln, fn + ln, fn[0] + ln, fn + '_' + ln, fn + ln[0]} if len(parts) > 1 else {fn}
                mail = next((e for e in own_emails if e.split('@')[0] in wanted and len(fn) > 2), '')
            people.append({'name': f['name'].strip(), 'role': (f.get('title') or 'Founder').strip() or 'Founder', 'tier': classify(f.get('title')),
                           'linkedin_url': li if 'linkedin.com' in li else '', 'twitter_url': f.get('twitter_url') or '', 'email': mail})
        notes = [f"Y Combinator {c.get('batch') or ''}".strip(), f"Team size: {c['team_size']}" if c.get('team_size') else '',
                 f"Stage: {c['stage']}" if c.get('stage') else '', 'Hiring now' if c.get('isHiring') else '', c['url']]
        companies.append({
            'name': c['name'].strip(), 'website': website, 'country': 'United States',
            'location': d.get('location') or (c.get('all_locations') or '').split(';')[0].strip(),
            'sector': c.get('subindustry', '').split(' -> ')[-1] or c.get('industry') or '',
            'description': c.get('one_liner') or '', 'about': c.get('long_description') or '',
            'logo_url': (c.get('small_logo_thumb_url') if 'missing' not in (c.get('small_logo_thumb_url') or 'missing') else '') or dp.get('logo_url') or '',
            'careers_url': careers, 'contact_url': s.get('contact_url') or '',
            'linkedin_url': d.get('linkedin_url') or s.get('linkedin_url') or '',
            'contact_email': general, 'hiring_email': hiring,
            'notes': ' · '.join(n for n in notes if n), 'source': 'Y Combinator', 'top': bool(c.get('top_company')),
            'hiring': bool(c.get('isHiring')), 'team_size': c.get('team_size') or 0, 'contacts': people,
        })
    names = {re.sub(r'\W', '', c['name'].lower()) for c in companies}
    for t in topstartups():
        if not re.search(r'\b(USA|United States)\b', t.get('location') or ''): continue
        if re.sub(r'\W', '', t['name'].lower()) in names: continue
        s = load(os.path.join(CACHE, 'sites', site_key(t['website']) + '.json')) or {}
        general, hiring = pick_emails(s.get('emails') or [], s.get('host') or '') if s.get('emails') else ('', '')
        companies.append({'name': t['name'], 'website': t['website'], 'country': 'United States', 'location': t['location'].replace(', USA', ''),
                          'sector': (t['tags'] or [''])[0], 'description': t['description'], 'about': '', 'logo_url': t['logo_url'],
                          'careers_url': t['careers_url'] or s.get('careers_url') or '', 'contact_url': s.get('contact_url') or '',
                          'linkedin_url': t['linkedin_url'] or s.get('linkedin_url') or '', 'contact_email': general, 'hiring_email': hiring,
                          'notes': ' · '.join(['topstartups.io'] + t['funding']), 'source': 'topstartups.io', 'top': True, 'hiring': bool(t['careers_url']),
                          'team_size': 0, 'contacts': []})
    save(os.path.join(OUT, 'companies.json'), companies)
    n = len(companies) or 1
    stat = lambda k: sum(1 for c in companies if c.get(k))
    print(f'companies {len(companies)}')
    for k in ['website', 'logo_url', 'location', 'linkedin_url', 'careers_url', 'contact_url', 'contact_email', 'hiring_email']:
        print(f'  {k:14} {stat(k):5} {100 * stat(k) // n}%')
    print('  any email     ', sum(1 for c in companies if c['contact_email'] or c['hiring_email']))
    print('  founder emails', sum(1 for c in companies for p in c['contacts'] if p.get('email')))
    print('  with contacts ', sum(1 for c in companies if c['contacts']), 'people', sum(len(c['contacts']) for c in companies),
          'with linkedin', sum(1 for c in companies for p in c['contacts'] if p['linkedin_url']))


def main():
    stage = sys.argv[1] if len(sys.argv) > 1 else 'all'
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    cos = yc_index()[:limit]
    print('US active YC companies:', len(cos), flush=True)
    if stage in ('yc', 'all'): run([(c,) for c in cos], yc_company, 5, 'yc')
    if stage in ('sites', 'all'):
        sites = [(site_key(c['website']), c['website']) for c in cos if c.get('website')]
        sites += [(site_key(t['website']), t['website']) for t in topstartups()]
        uniq = list({k: (k, w) for k, w in sites if k}.values())
        run(uniq, site_job, 24, 'sites')
    if stage == 'deep': deep()
    if stage in ('build', 'all'): build()


if __name__ == '__main__':
    main()
