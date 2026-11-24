#!/usr/bin/env python3
"""FoundReach: US and Indian startups from sources beyond the US Y Combinator scrape.

Stages (all cached on disk, safe to stop and re-run):
  collect  - read each source's public portfolio listing / API           -> cache/sources/<slug>/
  enrich   - each candidate's own website: is it alive, description, US evidence, careers page,
             contact page, LinkedIn company page, public company emails, icon   -> cache/sites, cache/deep, cache/facts
  build    - filter (US or India, operating, working site, description), dedupe on domain across sources and
             against the existing catalog, make slugs                    -> out/companies_multi.json

India (founder tasks #2 and #6): Antler rows whose location tag is India get country 'IN'. 'yc-india' is NOT collected:
YC's Terms of Use forbid scraping (see SKIPPED); its helpers stay for when YC gives permission. India rows carry country
'India'. India is stated either by the source (Antler's tag) or by the company's own site (india_evidence: a schema.org
address in India, an Indian city next to a 6-digit PIN, or a "Pvt Ltd" copyright together with a .in domain or an
Indian city). A city name alone or a domain alone is never evidence, and a site that shows US evidence stays US.
An Indian row's city comes from its source, else from that Indian address; never from the US-address check.
Elevation, Stellaris and Prime (task #6) list Indian portfolios with no country per company, so they rely on the site.
scripts/ingest.mjs holds India rows back until migration 202611260001 is applied.

Fetching: every request made through multi.py sends an honest FoundReachBot User-Agent. HTTP 403/429/503, a challenge
page and a time-out raise Blocked; collect() records each source as ok|blocked|empty|failed in cache/source_status.json.

Usage: python3 multi.py collect|enrich|build|all [--only a16z,accel] [--limit N] [--refresh] [--show-hn]
  --refresh  re-download the source listings (the weekly manual refresh); website caches are kept.

Sources and why (checked 2026-11-22, see SOURCES below):
  500 Global, Antler, a16z, Sequoia, Accel, Hacker News (Launch HN through the Algolia HN API).
  Elevation, Stellaris, Prime (India, checked 2026-11-23). Kae (terms) and Z47 (robots.txt) are NOT collected.
  Techstars is NOT collected: its Terms of Use forbid automated gathering of company information.
  Bessemer is NOT collected: its Terms forbid scraping. First Round is NOT collected: its robots.txt disallows AI agents.

Weekly manual refresh (none of the portfolio sources has a cheap "what is new" query, so they are not in the daily cron;
only Launch HN badges are, see founder-crm/api/_lib/sources/hn.js):
  python3 multi.py all --refresh
  cd ../founder-crm && node scripts/ingest.mjs ../scraper/out/companies_multi.json --dry-run
  SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... CRON_SECRET=... node scripts/ingest.mjs ../scraper/out/companies_multi.json --mark-new

Only publicly listed information is collected. People and emails are never guessed.
"""
import html, json, os, re, sys, time, threading, urllib.parse, urllib.error, datetime
import email.utils

import scrape
from scrape import CACHE, OUT, load, save, base_domain, site_key, pick_emails, emails_in, BAD_EMAIL, classify, run

SRC = os.path.join(CACHE, 'sources')
FACTS = os.path.join(CACHE, 'facts')
SITE_URL = 'https://foundreach.navaghandabhi.dev'
NOW_YEAR = datetime.date.today().year
# An honest User-Agent for every request made while multi.py runs (scrape.fetch reads scrape.UA at call time). No proxies.
scrape.UA = 'FoundReachBot/1.0 (+' + SITE_URL + ')'

# name, badge slug, listing page, robots/terms verdict (kept next to the code so the next run re-reads it)
SOURCES = {
    '500-global': {'name': '500 Global', 'page': 'https://500.co/portfolio',
                   'endpoint': 'https://500.co/api/startups',
                   'policy': 'robots.txt has no Disallow rules; no login. Terms: no anti-bot clause, but "no commercial use, resale, copying or '
                             'exploitation of material" without permission, so only facts are taken (name, website, country, year); '
                             'descriptions come from each company\'s own website.'},
    'antler': {'name': 'Antler', 'page': 'https://www.antler.co/portfolio', 'endpoint': 'https://www.antler.co/portfolio?<id>_page=N',
               'policy': 'robots.txt allows /portfolio (only /portfolio/company/ detail pages are disallowed and are not fetched); '
                         'Crawl-delay: 10 is honoured; no login; no terms-of-use page found.'},
    'a16z': {'name': 'a16z', 'page': 'https://a16z.com/portfolio/', 'endpoint': 'https://a16z.com/portfolio/ (data-companies JSON in the page)',
             'policy': 'robots.txt: "Disallow:" (nothing disallowed); no login. Terms: no anti-bot clause, but content "should not be used, '
                       'modified, or reproduced without our prior written consent", so only facts are taken (name, website, founders, '
                       'LinkedIn company link); descriptions and icons come from each company\'s own website.'},
    'sequoia': {'name': 'Sequoia', 'page': 'https://sequoiacap.com/our-companies',
                'endpoint': 'the site\'s own search index JSON (linked from the page) + one request per https://sequoiacap.com/companies/<slug>',
                'policy': 'robots.txt: "Allow: /"; no login; the /legal page has no clause about automated access or reuse.'},
    'accel': {'name': 'Accel', 'page': 'https://www.accel.com/companies', 'endpoint': 'https://www.accel.com/companies (JSON embedded in the page)',
              'policy': 'robots.txt allows / (only /admin/ and /api/ disallowed, neither is used); no login; no terms-of-use page found.'},
    'yc-india': {'name': 'Y Combinator', 'page': 'https://www.ycombinator.com/companies',
                 'endpoint': 'https://yc-oss.github.io/api/companies/all.json (public index, cached 7 days) + https://www.ycombinator.com/companies/<slug>',
                 'policy': 'NOT collected: YC\'s Terms of Use forbid "data mining, robots, scraping or similar data gathering" (see SKIPPED). '
                           'robots.txt alone would allow /companies/<slug>. The helpers stay in case YC gives written permission.'},
    'hacker-news': {'name': 'Hacker News', 'page': 'https://news.ycombinator.com/launches',
                    'endpoint': 'https://hn.algolia.com/api/v1/search_by_date (public documented HN Search API)',
                    'policy': 'Public API offered for programmatic use; no key, no login.'},
    'elevation': {'name': 'Elevation Capital', 'page': 'https://elevationcapital.com/portfolio',
                  'endpoint': 'https://elevationcapital.com/portfolio + one request per detail page linked from it',
                  'policy': 'Checked 2026-11-23: /robots.txt is HTTP 404 on apex and www (no rules), so a 2 s pause is used; no login. '
                            'The /privacy-and-terms page has a heading and no terms text: no clause on automated access or reuse. '
                            'Only facts are taken (name, website, sector, founders with LinkedIn /in/ links); descriptions come from '
                            'each company\'s own website. The Elevation office addresses on every page are never used.'},
    'stellaris': {'name': 'Stellaris Venture Partners', 'page': 'https://www.stellarisvp.com/portfolio',
                  'endpoint': 'https://www.stellarisvp.com/sitemap.xml (/portfolio/ detail URLs) + the listing for each company\'s status',
                  'policy': 'Checked 2026-11-23: robots.txt has only a Sitemap line (no Disallow), so a 2 s pause is used; no login; no terms '
                            'page exists (none in the footer or the sitemap). Only facts are taken; descriptions come from each company\'s '
                            'own website. Detail pages carry Stellaris staff emails: emails and mailto: links are never read.'},
    'prime': {'name': 'Prime Venture Partners', 'page': 'https://www.primevp.in/portfolio',
              'endpoint': 'https://www.primevp.in/portfolio (one page; Next.js payload, HTML fallback)',
              'policy': 'Checked 2026-11-23: robots.txt allows all except /api/ and /_next/ (neither is fetched); no login; only a '
                        'privacy policy exists, with no clause on automated access or reuse. Only facts are taken (name, website, '
                        'founder names); descriptions come from each company\'s own website.'},
}
SKIPPED = {
    'techstars': 'robots.txt allows /, and the portfolio page reads a public Typesense search API, BUT the Terms of Use forbid using "any bot, '
                 'spider, indexing agent, AI tool ... or other manual or automatic device to retrieve, index, scrape, data mine ... or otherwise '
                 'gather any Content or information about other companies". Skipped; needs written permission from Techstars.',
    'first-round': 'robots.txt disallows AI agents by name (ClaudeBot, Claude-User, anthropic-ai, GPTBot, ...). Skipped.',
    'general-catalyst': 'Allowed by robots.txt (except /list, /internal/), not collected this round: listing has names only; needs per-company pages.',
    'index-ventures': 'Allowed by robots.txt, not collected this round: listing has names only; needs per-company pages.',
    'bessemer': 'robots.txt allows the portfolio pages, BUT the Terms forbid "spidering, screen scraping, database scraping ... or any other '
                'automatic ... means of ... obtaining lists of users or other information from or through this Site". Skipped.',
    'lightspeed': 'Allowed by robots.txt, not collected this round: listing loads through admin-ajax with a nonce; names only.',
    'founders-fund': 'Allowed by robots.txt (Crawl-delay 10), not collected this round: ~64 companies, names only.',
    'khosla': 'robots.txt has no rules, not collected this round: listing has names only.',
    'yc-india': 'robots.txt allows /companies/<slug>, BUT YC\'s Terms of Use say "you will not engage in or use any data mining, robots, '
                'scraping or similar data gathering or extraction methods". Not collected; needs written permission from YC. '
                'The yc-oss index has no licence (unclear), so it is held as well.',
    'kae-capital': 'robots.txt allows all but /wp-admin/, BUT /terms-of-use/ allows only "personal, non-commercial transitory viewing" and '
                   'forbids "any commercial purpose or for any public display". Not collected (2026-11-23); replaced by Prime.',
    'z47': 'robots.txt disallows ClaudeBot, anthropic-ai, GPTBot and about 30 more agents (Disallow: /). Not collected (2026-11-23); '
           'replaced by Stellaris.',
}

# ---------------------------------------------------------------- small helpers
clean = lambda s: re.sub(r'\s+', ' ', html.unescape(str(s or ''))).strip()
TAGS = re.compile(r'<(script|style|noscript|svg)\b.*?</\1>|<[^>]+>', re.S | re.I)


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')


def norm_url(u):
    u = clean(u)
    if not u or ' ' in u or '@' in u.split('/')[0]: return ''
    if not re.match(r'https?://', u, re.I): u = 'https://' + u.lstrip('/')
    p = urllib.parse.urlparse(u)
    if '.' not in p.netloc or not re.fullmatch(r'[A-Za-z0-9.-]+(:\d+)?', p.netloc): return ''
    return u


def domain_of(u):
    u = norm_url(u)
    return base_domain(urllib.parse.urlparse(u).netloc) if u else ''


# Hosts that are not a company's own website.
PLATFORM = re.compile(r'(^|\.)(github\.com|github\.io|gitlab\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|linkedin\.com|facebook\.com|'
                      r'instagram\.com|medium\.com|substack\.com|apple\.com|google\.com|notion\.site|notion\.so|vercel\.app|netlify\.app|'
                      r'herokuapp\.com|pages\.dev|web\.app|firebaseapp\.com|linktr\.ee|bit\.ly|t\.co|loom\.com|producthunt\.com|'
                      r'ycombinator\.com|crunchbase\.com|angel\.co|wellfound\.com|wikipedia\.org|amazon\.com|microsoft\.com|chrome\.google\.com|'
                      r'itch\.io|npmjs\.com|pypi\.org|huggingface\.co|reddit\.com|discord\.gg|discord\.com|t\.me|typeform\.com|calendly\.com|'
                      r'wordpress\.com|blogspot\.com|wixsite\.com|carrd\.co|gumroad\.com|arxiv\.org|fly\.dev|onrender\.com|streamlit\.app|'
                      r'replit\.app|repl\.co|workers\.dev|glitch\.me|readthedocs\.io|sourceforge\.net|codeberg\.org|sr\.ht)$', re.I)

INDUSTRY_RULES = [
    ('B2B', r'\bb2b\b'),
    ('Fintech', r'fin\s?tech|financ|insur|payment|bank|crypto|blockchain|web3|defi|lending|wealth|accounting'),
    ('Healthcare', r'health|bio|medic|pharma|life scien|therap|clinic|femtech|oncolog|diagnos'),
    ('Education', r'ed\s?tech|educat|e-?learning'),
    ('Real Estate and Construction', r'real estate|prop\s?tech|construction|housing'),
    ('Government', r'gov\s?tech|government|public sector|civic'),
    ('Industrials', r'industrial|manufactur|robot|hardware|energy|climate|clean\s?tech|space|aerospace|aviation|logistic|supply chain|'
                    r'ag\s?tech|agricultur|mobility|automotive|transport|drone|material|semiconductor|defen[cs]e|mining|oil|sustainab'),
    ('Consumer', r'consumer|b2c|gaming|games|e-?commerce|social media|entertain|food|beverage|beauty|travel|fashion|retail|'
                 r'creator|music|sport|fitness|pet|dating|lifestyle'),
    ('B2B', r'enterprise|saas|b2b|developer|dev\s?tools|infrastructure|infra\b|cyber|security|data|analytics|hr\b|hrtech|human resources|'
            r'marketing|legal|productivity|sales|cloud|software|future of work|workflow|automation|adtech'),
]


def industry_for(*labels):
    """Map a source's sector labels onto the catalog's 8 industries; None when not reasonably clear."""
    for label in labels:
        t = clean(label).lower()
        if not t: continue
        for ind, pat in INDUSTRY_RULES:
            if re.search(pat, t): return ind
    return None


class Blocked(Exception):
    """A source refused us (HTTP 403/429/503, a challenge page) or did not answer (status 'timeout'). Never '0 companies'."""
    def __init__(self, status, url):
        super().__init__(f'blocked ({status}) at {url}')
        self.status, self.url = status, url


CHALLENGE_TITLE = re.compile(r'<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied|Verify(?:ing)? you are human)', re.I)
CHALLENGE_TEXT = re.compile(r'cf-chl|Just a moment\.\.\.|captcha|Attention Required', re.I)


def is_challenge(text):
    """A bot-check page instead of the content. A normal page that merely loads a captcha widget for its contact form is not one:
    the generic markers count only when the page has little readable text. JSON answers are never challenge pages."""
    t = (text or '').lstrip()[:400000]
    if t[:1] in ('{', '['): return False
    if CHALLENGE_TITLE.search(t[:20000]): return True
    return bool(CHALLENGE_TEXT.search(t)) and len(clean(TAGS.sub(' ', t))) < 3000


def retry_after(value, default=30, cap=300):
    """Seconds to wait from a Retry-After header (seconds or an HTTP date), capped; `default` when missing or unreadable."""
    v = clean(value)
    if re.fullmatch(r'\d+', v): return min(int(v), cap)
    if v:
        try:
            d = email.utils.parsedate_to_datetime(v)
            return max(0, min(cap, int((d - datetime.datetime.now(datetime.timezone.utc)).total_seconds())))
        except Exception:
            pass
    return default


LOGIN_PATH = re.compile(r'/(?:login|signin|sign-in|users/sign_in)(?:/|\.\w+$|$)', re.I)   # a whole path segment: /login, /login.php


def login_redirect(requested, final):
    """True when a 200 answer came from a different path that is a sign-in page: the source wants a login, which we never do."""
    if not final: return False
    want, got = urllib.parse.urlparse(requested).path or '/', urllib.parse.urlparse(final).path or '/'
    return want.rstrip('/') != got.rstrip('/') and bool(LOGIN_PATH.search(got))


def fetch_checked(url, timeout=40, limit=30_000_000):
    """scrape.fetch, but a refusal, a time-out or a jump to a sign-in page raises Blocked. After 429/503 it waits (Retry-After)
    and tries once more."""
    for attempt in (1, 2):
        try:
            final, text = scrape.fetch(url, timeout=timeout, limit=limit)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt == 1:
                time.sleep(retry_after(e.headers.get('Retry-After') if e.headers else None))
                continue
            if e.code in (403, 429, 503): raise Blocked(e.code, url)
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise Blocked('timeout', url)
        if login_redirect(url, final): raise Blocked('login', url)
        if is_challenge(text): raise Blocked('challenge', url)
        return text


def cached_text(path, url, refresh=False, timeout=40, limit=30_000_000, pause=0.5):
    if os.path.exists(path) and not refresh:
        with open(path, encoding='utf-8') as f: return f.read()
    text = fetch_checked(url, timeout=timeout, limit=limit)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'w', encoding='utf-8') as f: f.write(text)
    os.replace(path + '.tmp', path)
    time.sleep(pause)
    return text


def next_payload(text):
    """The JSON stream a Next.js page ships inside self.__next_f.push([1,"..."]) calls."""
    return ''.join(json.loads('"' + m + '"') for m in re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', text))


LEGAL_SUFFIX = re.compile(r'[\s,]+(?:inc|incorporated|llc|l\.l\.c|corp|corporation|co|pbc|company)\.?,?$', re.I)


def tidy_name(n):
    """'MANTAS INSURANCE SOLUTIONS, INC.' -> 'Mantas Insurance Solutions'. Only the legal suffix and shouting are removed."""
    n = clean(n).strip(' ,;')
    for _ in range(2): n = LEGAL_SUFFIX.sub('', n).strip(' ,;')
    if n.isupper() and len(n.split()) >= 2: n = n.title()
    return n


def site_casing(name, f):
    """The source spells some names in one case ('Circleci'); if the company's own site spells the same letters differently, use that."""
    for cand in f.get('names') or []:
        if cand != name and cand.lower() == name.lower(): return cand
    return name


def people_from_names(names, role='Founder'):
    out, seen = [], set()
    for n in names:
        n = clean(n)
        if not re.fullmatch(r"[^\d@/<>|]{3,60}", n) or len(n.split()) < 2 or len(n.split()) > 5: continue
        if n.lower() in seen: continue
        seen.add(n.lower())
        parts = n.split()
        out.append({'first_name': parts[0], 'last_name': ' '.join(parts[1:]), 'role': role, 'role_category': classify(role), 'linkedin_url': ''})
    return out[:12]


# ---------------------------------------------------------------- collectors
# Each returns a list of candidates:
# {source, name, website, description (only when the source's text may be used), sector, industry, location (city or ''),
#  country ('US' | 'other' | ''), active (False when the source marks an exit/shutdown), source_url, badge, year, people, linkedin_url}

def collect_500(refresh):
    text = cached_text(os.path.join(SRC, '500-global', 'startups.json'), SOURCES['500-global']['endpoint'], refresh)
    out = []
    for s in (json.loads(text).get('res') or []):
        org = s.get('organization') or {}
        country = clean((org.get('countryOfOperation') or {}).get('name')).lower()
        stage = clean((s.get('stage') or {}).get('name'))
        model = clean((s.get('businessModel') or {}).get('name'))
        if model == 'Fund' or stage == 'Active fund': continue   # funds, not startups
        inds = [clean(i.get('name')) for i in s.get('industries') or [] if clean(i.get('name')) and 'agnostic' not in i.get('name', '').lower()]
        years = sorted(d['initialInvestDate'][:4] for d in s.get('investments') or [] if re.match(r'(19|20)\d\d', d.get('initialInvestDate') or ''))
        year = int(years[0]) if years and 2005 <= int(years[0]) <= NOW_YEAR else None   # 1970 is an empty date
        name = tidy_name(org.get('businessName') or org.get('name'))
        li = norm_url(org.get('companyLinkedIn'))
        out.append({'source': '500-global', 'name': name, 'website': norm_url(org.get('companyUrl')), 'description': '',
                    'sector': inds[0] if inds else '', 'industry': industry_for(*inds, {'B2B': 'b2b', 'B2C': 'consumer'}.get(model, '')),
                    'location': '', 'country': 'US' if country == 'united states' else ('other' if country else ''),
                    'active': stage != 'Exited', 'source_url': SOURCES['500-global']['page'],
                    'badge': f'500 Global {year}' if year else '500 Global portfolio', 'year': year,
                    # The listing names people without a role; a role would be a guess, so nobody is taken from here.
                    'people': [], 'linkedin_url': li if '/company/' in li else ''})
    return out


def antler_country(loc):
    """Antler's first tag is the country: 'US' and 'IN' are kept, any other country is 'other', no tag is ''."""
    loc = clean(loc)
    if loc.upper() in ('US', 'USA', 'UNITED STATES'): return 'US'
    if loc.lower() == 'india': return 'IN'
    return 'other' if loc else ''


# ---- Y Combinator, India. The index is public JSON; founders come from the YC company page (scrape.yc_company, cached per slug).
YC_PAGES_PER_RUN = 150          # at most this many uncached YC company pages per run; the rest wait for the next night
YC_INDEX_MAX_AGE = 7 * 86400    # re-download the public index when the cached copy is older than this
YC_SEASON = {'winter': 'W', 'summer': 'S', 'fall': 'F', 'spring': 'X'}


def yc_city(all_locations):
    """'Bengaluru, KA, India; Remote' -> 'Bengaluru'. Only the first listed location counts; a bare 'Remote' is no city."""
    first = clean((all_locations or '').split(';')[0])
    parts = [p.strip() for p in first.split(',') if p.strip()]
    return parts[0] if len(parts) >= 2 else ''


def is_yc_india(c):
    """Operating YC company whose first listed location is in India. `regions` alone also tags US companies with an Indian office."""
    first = clean((c.get('all_locations') or '').split(';')[0])
    return ('India' in (c.get('regions') or []) and c.get('status') in ('Active', 'Public')
            and bool(re.search(r'(^|,\s*)India$', first)))


def yc_people(founders):
    """YC founders -> catalog people: name, role and a personal LinkedIn /in/ link only. Nothing else is copied (no email)."""
    out, seen = [], set()
    for f in founders or []:
        name = clean(f.get('name'))
        if not name or '@' in name or f.get('active') is False or name.lower() in seen: continue   # former founders are not listed
        seen.add(name.lower())
        parts = name.split()
        role = clean(f.get('title')) or 'Founder'
        li = clean(f.get('linkedin_url'))
        if li and not re.match(r'https?://', li, re.I): li = 'https://' + li.lstrip('/')
        li = li if re.match(r'https?://([a-z0-9-]+\.)*linkedin\.com/in/[^/?#\s]+', li, re.I) else ''
        out.append({'first_name': parts[0], 'last_name': ' '.join(parts[1:]), 'role': role[:160], 'role_category': classify(role),
                    'linkedin_url': li})
    return out[:12]


def yc_batch(batch):
    """'Winter 2015' -> ('YC W15', 2015); anything else -> ('Y Combinator', year or None)."""
    m = re.fullmatch(r'(Winter|Summer|Fall|Spring)\s+((?:19|20)\d\d)', clean(batch), re.I)
    if m: return f'YC {YC_SEASON[m.group(1).lower()]}{m.group(2)[2:]}', int(m.group(2))
    y = re.search(r'\b((?:19|20)\d\d)\b', clean(batch))
    return 'Y Combinator', int(y.group(1)) if y else None


def yc_candidate(c, d):
    """One yc-india candidate from the index record `c` and the cached company page `d`."""
    logo = c.get('small_logo_thumb_url') or ''
    li = clean(d.get('linkedin_url'))
    if li and not re.match(r'https?://', li, re.I): li = 'https://' + li.lstrip('/')
    label, year = yc_batch(c.get('batch'))
    url = c.get('url') or f"https://www.ycombinator.com/companies/{c.get('slug')}"
    return {'source': 'yc-india', 'name': clean(c.get('name')), 'website': norm_url(c.get('website')),
            'description': clean(c.get('one_liner')), 'sector': clean((c.get('subindustry') or '').split(' -> ')[-1]) or clean(c.get('industry')),
            'industry': industry_for(c.get('industry'), c.get('subindustry')),
            'location': yc_city(c.get('all_locations')) or clean(d.get('city')), 'country': 'IN', 'active': True,
            'source_url': url, 'badge': label, 'badge_source': 'yc', 'year': year, 'people': yc_people(d.get('founders')),
            'linkedin_url': li if '/company/' in li else '', 'logo_url': norm_url(logo) if 'missing' not in logo else '',
            'careers_url': url + '/jobs' if c.get('isHiring') or d.get('jobs') else ''}


def yc_all(refresh):
    path = os.path.join(CACHE, 'yc_all.json')
    fresh = os.path.exists(path) and time.time() - os.path.getmtime(path) < YC_INDEX_MAX_AGE
    data = load(path) if fresh and not refresh else None
    if not data:
        try:
            _, text = scrape.fetch(scrape.YC_INDEX, timeout=90, limit=50_000_000)
            data = json.loads(text); save(path, data)
        except Exception as e:     # keep working from the older copy
            print(f'[collect] yc-india: index download failed ({type(e).__name__}), using the cached copy', flush=True)
            data = load(path) or []
    return data


def collect_yc_india(refresh):
    out, fetched, waiting = [], 0, 0
    for c in yc_all(refresh):
        if not is_yc_india(c) or not c.get('slug'): continue
        path = os.path.join(CACHE, 'yc', c['slug'] + '.json')
        if not os.path.exists(path):
            if fetched >= YC_PAGES_PER_RUN: waiting += 1; continue    # next night carries on from here
            fetched += 1
            scrape.yc_company(c)                                        # caches the page facts and pauses between requests
        d = load(path) or {}
        if not d or d.get('missing'): continue
        if d.get('country') and d['country'] not in ('IN', 'India'): continue   # the company page places it elsewhere
        out.append(yc_candidate(c, d))
    print(f'[collect] yc-india: {fetched} YC pages fetched, {waiting} left for the next run', flush=True)
    return out


def collect_antler(refresh):
    base = SOURCES['antler']['page']
    out, url, page = [], base, 1
    while url and page <= 80:
        text = cached_text(os.path.join(SRC, 'antler', f'page_{page}.html'), url, refresh, pause=10.5)   # robots.txt: Crawl-delay 10
        i = text.find('portco_cms_list')
        cards = text[i:].split('class="w-dyn-item"')[1:] if i >= 0 else []
        for card in cards:
            card = card.split('w-pagination-wrapper')[0]
            field = lambda f: clean(TAGS.sub(' ', (re.search(r'fs-cmsfilter-field="%s"[^>]*>(.*?)</p>' % f, card, re.S) or [None, ''])[1]))
            wraps = re.findall(r'<div fs-cmsfilter-field="([^"]*)" class="tag_small_wrap">\s*<div[^>]*>(.*?)</div>', card, re.S)
            loc = sector = year = ''
            for idx, (kind, val) in enumerate(wraps):
                val = clean(TAGS.sub(' ', val))
                if kind == 'sector': sector = val
                elif kind == 'year': year = val
                elif idx == 0: loc = val        # the first tag is the country; its field attribute repeats the value
            href = re.search(r'<a\b[^>]*href="(https?://[^"]+)"[^>]*class="clickable_link', card) or re.search(r'class="clickable_link[^"]*"[^>]*href="(https?://[^"]+)"', card)
            name = field('name')
            if not name: continue
            y = int(year) if re.fullmatch(r'(19|20)\d\d', year) else None
            out.append({'source': 'antler', 'name': name, 'website': norm_url(html.unescape(href.group(1))) if href else '',
                        'description': field('description'), 'sector': sector, 'industry': industry_for(sector),
                        'location': '', 'country': antler_country(loc),
                        'active': True, 'source_url': base, 'badge': f'Antler {y}' if y else 'Antler portfolio', 'year': y,
                        'people': [], 'linkedin_url': '', 'raw_location': loc})
        nxt = re.search(r'<a href="(\?[0-9a-f]+_page=\d+)"[^>]*class="w-pagination-next', text)
        url = base + html.unescape(nxt.group(1)) if nxt and cards else ''
        page += 1
    return out


def collect_a16z(refresh):
    text = cached_text(os.path.join(SRC, 'a16z', 'portfolio.html'), SOURCES['a16z']['page'], refresh)
    m = re.search(r'data-companies="([^"]+)"', text)
    out = []
    for c in (json.loads(html.unescape(m.group(1))) if m else []):
        verticals = [v for v in clean(c.get('verticals')).split(';') if v and v not in ('Seed', 'Growth', 'Cultural Leadership Fund')]
        li = next((norm_url(s.get('url')) for s in c.get('socials') or [] if 'linkedin.com/company/' in (s.get('url') or '')), '')
        out.append({'source': 'a16z', 'name': clean(c.get('name') or c.get('post_title')),
                    'website': norm_url(c.get('external_url') or c.get('company_url') or c.get('url')),
                    'description': '',   # a16z terms: text is not reproduced; the company's own site supplies it
                    'sector': verticals[0] if verticals else '',
                    'industry': industry_for(*[{'Bio + Health': 'health', 'Infra': 'infrastructure'}.get(v, v) for v in verticals
                                               if v not in ('Frontier', 'American Dynamism')]),
                    'location': '', 'country': '', 'active': clean(c.get('status')) == 'Active' and not clean(c.get('acquirer')),
                    'source_url': SOURCES['a16z']['page'], 'badge': 'a16z portfolio', 'year': None,
                    'people': people_from_names(re.split(r',|\band\b|&', clean(c.get('founders_list')))), 'linkedin_url': li})
    return out


def collect_accel(refresh):
    text = cached_text(os.path.join(SRC, 'accel', 'companies.html'), SOURCES['accel']['page'], refresh)
    pl, dec, seen, out = next_payload(text), json.JSONDecoder(), {}, []
    for m in re.finditer(r'\{"_createdAt"', pl):
        try: o, _ = dec.raw_decode(pl[m.start():])
        except ValueError: continue
        if o.get('_type') == 'company' and o.get('_id'): seen[o['_id']] = o
    block_text = lambda blocks: [clean(''.join(ch.get('text', '') for ch in b.get('children') or [])) for b in blocks or [] if isinstance(b, dict)]
    for o in seen.values():
        slug = (o.get('slug') or {}).get('current') or ''
        out.append({'source': 'accel', 'name': clean(o.get('name')), 'website': norm_url(o.get('websiteUrl')),
                    'description': clean(' '.join(block_text(o.get('shortDescription')))), 'sector': '', 'industry': None,
                    'location': '', 'country': '', 'active': not clean(o.get('firstExitType')) and not clean(o.get('secondaryExitType')),
                    'source_url': 'https://www.accel.com/companies/' + slug if slug else SOURCES['accel']['page'],
                    'badge': 'Accel portfolio', 'year': None, 'people': people_from_names(block_text(o.get('founders'))), 'linkedin_url': ''})
    return out


SEQ_SKIP = re.compile(r'(^|\.)(sequoiacap\.com|framer\.com|framerusercontent\.com|gstatic\.com|googleapis\.com|twitter\.com|x\.com|linkedin\.com|'
                      r'instagram\.com|facebook\.com|youtube\.com|github\.com|tiktok\.com|medium\.com|apple\.com|google\.com|spotify\.com|threads\.net)$', re.I)


def collect_sequoia(refresh):
    base = 'https://sequoiacap.com'
    page = cached_text(os.path.join(SRC, 'sequoia', 'our-companies.html'), SOURCES['sequoia']['page'], refresh)
    idx = re.search(r'<meta name="framer-search-index" content="(https://framerusercontent\.com/[^"]+\.json)"', page)
    index = json.loads(cached_text(os.path.join(SRC, 'sequoia', 'search-index.json'), idx.group(1), refresh)) if idx else {}
    out = []
    for path, meta in sorted(index.items()):
        m = re.fullmatch(r'/companies/([a-z0-9-]+)', path)
        if not m: continue
        try:
            text = cached_text(os.path.join(SRC, 'sequoia', 'companies', m.group(1) + '.html'), base + path, refresh, timeout=25, limit=3_000_000, pause=0.7)
        except Exception:
            continue
        links = [html.unescape(h) for h in re.findall(r'<a\b[^>]*href="(https?://[^"]+)"', text)]
        site = next((u for u in links if domain_of(u) and not SEQ_SKIP.search(domain_of(u))), '')
        li = next((u for u in links if 'linkedin.com/company/' in u), '')
        miles = [clean(x) for x in re.findall(r'<p\b[^>]*>((?:Founded|Partnered|IPO|Acquired|Merged|Direct Listing|SPAC)[^<]{0,40})</p>', text)]
        founders = [clean(n) for n in re.findall(r'href="(?:\.\./|/)?founder/[^"]+"[^>]*>([^<]{3,60})</a>', text)]
        cats = [clean(n) for n in re.findall(r'href="[^"]*our-companies\?categories=[^"]+"[^>]*>([^<]{2,40})</a>', text)]
        name = clean(re.sub(r'\s*\|\s*Sequoia Capital.*$', '', meta.get('title') or ''))
        if not name: continue
        desc = clean(meta.get('description'))
        if desc.startswith('We help the daring build legendary companies') or re.search(r'is a Sequoia-backed company since', desc): desc = ''   # boilerplate
        label = lambda t: t.upper() if len(t) <= 3 else t.title()
        out.append({'source': 'sequoia', 'name': name, 'website': norm_url(site), 'description': desc[:400],
                    'sector': label(cats[0]) if cats else '', 'industry': industry_for(*cats), 'location': '', 'country': '',
                    # Like a16z and Accel, an IPO or acquisition is treated as an exit: the directory is for startups.
                    'active': not any(re.match(r'Acquired|Merged|IPO|Direct Listing|SPAC', x) for x in miles), 'source_url': base + path,
                    'badge': 'Sequoia portfolio', 'year': None, 'people': people_from_names(founders), 'linkedin_url': norm_url(li)})
    return out


# ---- India portfolios (founder task #6): Elevation, Stellaris, Prime. None states a country per company, so every row
# leaves country '' and India comes from the company's own site (india_evidence). Only facts are taken; no descriptions.
INDIA_SITE_SOURCES = {'elevation', 'stellaris', 'prime', 'accel'}   # rows whose website is checked for an Indian address
INDIA_PAUSE = 2.0               # none of the three gives a Crawl-delay: 2 s between requests
DETAIL_MAX_AGE = 30 * 86400     # a cached detail page is re-fetched only after 30 days, whatever --refresh says
DETAIL_CAP = 150                # at most this many new detail fetches per source per run; the next night carries on
_detail_blocks = {}             # source slug -> Blocked raised on a detail page during this run (read by collect())

FUND_HOSTS = re.compile(r'(^|\.)(elevationcapital\.com|stellarisvp\.com|primevp\.in|sanity\.io|webflow\.com|website-files\.com|'
                        r'cloudfront\.net|googletagmanager\.com|gstatic\.com|googleapis\.com|w3\.org|schema\.org|tiktok\.com|'
                        r'threads\.net|spotify\.com|accel\.com)$', re.I)
ANCHOR = re.compile(r'<a\b([^>]*)>(.*?)</a>', re.S | re.I)
LI_IN = re.compile(r'https?://([a-z0-9-]+\.)*linkedin\.com/in/[^/?#\s"\'<>]+', re.I)
ROLE_WORDS = re.compile(r'\b(founder|co-?founder|ceo|cto|coo|cfo|cpo|chief|director|partner|president|head|vp|principal|associate|'
                        r'analyst|managing|chairman|officer)\b', re.I)
NOT_A_NAME = re.compile(r'^(investing stage|entry stage|elevation team|stellaris team|view all|read more|visit website|co-?investors?|'
                        r'linked ?in|the team|our team|know more|learn more)$', re.I)
FOUNDERS_HEAD = r'>\s*Founders?\s*(?=<)'   # an element whose whole text is "Founder(s)"; the block starts at its closing tag
STAGE_WORD = re.compile(r'^(pre-?seed|seed|early|early stage|growth|late|series [a-f]|idea)$', re.I)


def anchors(page):
    """(href, text, start, end, attrs, inner) for each <a> of a page. Text has tags removed; an aria-label stands in for empty text."""
    for m in ANCHOR.finditer(page or ''):
        attrs = m.group(1)
        h = re.search(r'\bhref\s*=\s*["\']([^"\']+)["\']', attrs)
        text = clean(TAGS.sub(' ', m.group(2)))
        if not text:
            al = re.search(r'\baria-label\s*=\s*["\']([^"\']+)["\']', attrs)
            text = clean(al.group(1)) if al else ''
        yield html.unescape(h.group(1)).strip() if h else '', text, m.start(), m.end(), attrs, m.group(2)


def segments(fragment):
    """The visible text pieces of an HTML fragment, in order."""
    return [s for s in (clean(x) for x in re.split(r'<[^>]+>', TAGS.sub(lambda m: ' ' if m.group(1) else m.group(0), fragment or ''))) if s]


def own_site(u):
    """A company's own website: not a platform (LinkedIn, GitHub, ...), not the fund's own site or its CDN."""
    d = domain_of(u)
    return bool(d) and not PLATFORM.search(d) and not FUND_HOSTS.search(d)


def no_emails(page):
    """Fund pages carry staff emails: drop mailto: links and anything shaped like an email before anything is read."""
    page = re.sub(r'<a\b[^>]*href=["\']mailto:[^"\']*["\'][^>]*>.*?</a>', ' ', page or '', flags=re.S | re.I)
    page = re.sub(r'mailto:[^"\'\s<>]*', ' ', page, flags=re.I)
    return scrape.EMAIL.sub(' ', page)


def linkedin_in(u):
    """A personal LinkedIn /in/ link with its query string removed, or ''."""
    m = LI_IN.match(clean(u))
    return m.group(0).rstrip('/') + '/' if m else ''


def person_name(s):
    s = clean(s)
    if '@' in s or NOT_A_NAME.match(s) or ROLE_WORDS.search(s): return ''
    if not re.fullmatch(r"[^\W\d_](?:[^\W\d_]|[.'’\- ]){2,58}", s): return ''
    return s if 2 <= len(s.split()) <= 5 else ''


def founders_between(page, start_rx, end_rx):
    """People with a LinkedIn /in/ link between a 'Founders' heading and the next block (the fund's own team). Nothing outside it:
    with no closing block nobody is taken, so a fund partner can never be listed as a founder."""
    s = re.search(start_rx, page or '')
    if not s: return []
    e = re.search(end_rx, page[s.end():], re.I)
    if not e: return []
    block = page[s.end():s.end() + e.start()]
    links = [a for a in anchors(block) if linkedin_in(a[0])]
    out, seen, last = [], set(), 0
    for i, (href, text, start, end, _, _) in enumerate(links):
        li = linkedin_in(href)
        before = segments(block[last:start])
        after = segments(block[end:links[i + 1][2] if i + 1 < len(links) else len(block)])
        name = person_name(text) or next((person_name(x) for x in reversed(before) if person_name(x)), '') \
            or next((person_name(x) for x in after if person_name(x)), '')
        last = end
        if not name or li in seen: continue
        seen.add(li)
        role = next((x for x in before + after if ROLE_WORDS.search(x) and len(x) <= 60 and '@' not in x), '') or 'Founder'
        parts = name.split()
        out.append({'first_name': parts[0], 'last_name': ' '.join(parts[1:]), 'role': role, 'role_category': classify(role),
                    'linkedin_url': li})
    return out[:12]


def sector_after_stage(segs):
    """Elevation and Stellaris print 'stage, sector': the short piece right after a stage word ('Seed', 'Growth') is the sector."""
    for i, s in enumerate(segs[:-1]):
        nxt = segs[i + 1]
        if STAGE_WORD.match(s) and len(nxt) <= 40 and not STAGE_WORD.match(nxt) and industry_for(nxt): return nxt
    return ''


def india_candidate(slug, name, website, sector, source_url, people, year=None, linkedin=''):
    meta = SOURCES[slug]
    return {'source': slug, 'name': tidy_name(name), 'website': norm_url(website) if own_site(website) else '', 'description': '',
            'sector': sector, 'industry': industry_for(sector), 'location': '', 'country': '', 'active': True,
            'source_url': source_url, 'badge': f"{meta['name']} {year}" if year else f"{meta['name']} portfolio", 'year': year,
            'people': people, 'linkedin_url': linkedin}


class DetailPages:
    """One source's detail pages, cached in cache/sources/<slug>/detail/. A cached page is re-fetched only after DETAIL_MAX_AGE,
    whatever --refresh says; at most `cap` new fetches per run, so the next night continues where this one stopped. A refusal
    (403/429/503, a challenge or a sign-in page) stops this source's detail fetches for the run at once; time-outs stop them only
    after TIMEOUTS_IN_A_ROW in a row, so one slow page does not end the night (older cached pages are still read)."""
    TIMEOUTS_IN_A_ROW = 3

    def __init__(self, slug, cap=DETAIL_CAP, pause=INDIA_PAUSE):
        self.slug, self.cap, self.pause = slug, cap, pause
        self.fetched = self.waiting = self.timeouts = 0
        self.blocked = None

    def path(self, key):
        return os.path.join(SRC, self.slug, 'detail', (re.sub(r'[^a-z0-9-]+', '-', key.lower()).strip('-') or 'index')[:100] + '.html')

    def get(self, key, url):
        path = self.path(key)
        have = os.path.exists(path)
        if have and time.time() - os.path.getmtime(path) < DETAIL_MAX_AGE: return cached_text(path, url)
        if self.blocked or self.fetched >= self.cap:
            if not self.blocked: self.waiting += 1
            return cached_text(path, url) if have else None
        self.fetched += 1
        try:
            text = cached_text(path, url, refresh=True, timeout=25, limit=3_000_000, pause=self.pause)
            self.timeouts = 0
            return text
        except Blocked as e:
            if e.status == 'timeout':
                self.timeouts += 1
                print(f'[collect] {self.slug}: {url} timed out ({self.timeouts} in a row)', flush=True)
                if self.timeouts >= self.TIMEOUTS_IN_A_ROW: self.blocked = _detail_blocks[self.slug] = e
            else:
                self.blocked = _detail_blocks[self.slug] = e
        except Exception as e:
            print(f'[collect] {self.slug}: {url} failed ({type(e).__name__})', flush=True)
        return cached_text(path, url) if have else None

    def report(self):
        print(f'[collect] {self.slug}: {self.fetched} detail pages fetched, {self.waiting} left for the next run'
              + (f', blocked ({self.blocked.status}) at {self.blocked.url}' if self.blocked else ''), flush=True)


ELEVATION_NAV = {'/portfolio', '/team', '/about', '/about-us', '/insights', '/privacy-and-terms', '/contact', '/careers', '/news', '/blog',
                 '/founders', '/people', '/approach', '/stories', '/media', '/jobs', '/terms', '/privacy'}


def elevation_cards(listing, base='https://elevationcapital.com/portfolio'):
    """(path, card inner HTML) per company. Detail hrefs are read from the listing, never built from names: /portfolio/<slug>,
    or a one-segment path whose link wraps a card (an image or 40+ characters of text). '/' (Indiamart) is skipped."""
    out, seen = [], set()
    for href, text, _, _, _, inner in anchors(listing):
        p = urllib.parse.urlparse(urllib.parse.urljoin(base, href))
        if p.netloc and not p.netloc.lower().endswith('elevationcapital.com'): continue
        path = p.path.rstrip('/').lower()
        if not path or path in ELEVATION_NAV or path in seen: continue
        if not (re.fullmatch(r'/portfolio/[a-z0-9-]+', path) or (re.fullmatch(r'/[a-z0-9-]+', path) and ('<img' in inner.lower() or len(text) >= 40))):
            continue
        seen.add(path)
        out.append((path, inner))
    return out


def parse_elevation_detail(page):
    """{name, website, people, sector} from /portfolio/<slug>. The website is the link 'Visit <name> website'. Founders are the /in/
    links between the 'Founders' heading and 'Elevation Team'; the Elevation partners after it are never taken."""
    page = no_emails(page)
    name = website = ''
    for href, text, *_ in anchors(page):
        m = re.fullmatch(r'Visit\s+(.+?)\s+website', text, re.I)
        if m and own_site(href):
            name, website = clean(m.group(1)), norm_url(href)
            break
    f = re.search(FOUNDERS_HEAD, page)
    return {'name': name, 'website': website, 'people': founders_between(page, FOUNDERS_HEAD, r'Elevation\s+Team'),
            'sector': sector_after_stage(segments(page[:f.start()] if f else page))}


def collect_elevation(refresh):
    base = SOURCES['elevation']['page']
    listing = cached_text(os.path.join(SRC, 'elevation', 'portfolio.html'), base, refresh, pause=INDIA_PAUSE)
    pages, out = DetailPages('elevation'), []
    for path, inner in elevation_cards(listing):
        url = urllib.parse.urljoin(base, path)
        page = pages.get(path, url)
        d = parse_elevation_detail(page) if page else {}
        card = segments(inner)
        name = d.get('name') or (card[0] if card and len(card[0]) <= 60 else '')
        if not name: continue
        out.append(india_candidate('elevation', name, d.get('website', ''), sector_after_stage(card) or d.get('sector', ''), url,
                                   d.get('people') or []))
    pages.report()
    return out


def stellaris_listing(listing):
    """slug -> (status, theme) from the listing cards. Status is Active, Inactive or Exited."""
    chunks = listing.split('w-dyn-item')[1:] if 'w-dyn-item' in listing else None
    if chunks is None:   # no Webflow list markup: cut at each detail link instead
        hits = [m.start() for m in re.finditer(r'href=["\'](?:https?://(?:www\.)?stellarisvp\.com)?/portfolio/[a-z0-9-]+', listing)]
        chunks = [listing[a:b] for a, b in zip(hits, hits[1:] + [len(listing)])]
    out = {}
    for ch in chunks:
        m = re.search(r'href=["\'](?:https?://(?:www\.)?stellarisvp\.com)?/portfolio/([a-z0-9-]+)', ch)
        st = re.search(r'>\s*(Active|Inactive|Exited)\s*<', ch)
        if not m or m.group(1) in out: continue
        th = re.search(r'\bTHEME\s+(.+?)\s+ENTRY STAGE\b', ' '.join(segments(ch)), re.I)
        out[m.group(1)] = (st.group(1) if st else '', clean(th.group(1)) if th else '')
    return out


def parse_stellaris_detail(page):
    """{name, website, people, year, linkedin_url, status} from /portfolio/<slug>. Emails and mailto: links are removed first."""
    page = no_emails(page)
    f = re.search(FOUNDERS_HEAD, page)
    head = page[:f.start()] if f else page
    links = [(h, t, a) for h, t, _, _, a, _ in anchors(head) if re.match(r'https?://', h) and own_site(h)]
    pick = next((x for x in links if re.search(r'website|visit', x[1] + ' ' + x[2], re.I) or domain_of(x[1]) == domain_of(x[0])), None)
    website = norm_url((pick or (links[0] if links else ('',)))[0])
    h1 = re.search(r'<h1\b[^>]*>(.*?)</h1>', page, re.S | re.I)
    name = clean(TAGS.sub(' ', h1.group(1))) if h1 else ''
    text = ' '.join(segments(page))
    yr = re.search(r'Partnered\D{0,20}((?:19|20)\d\d)', text, re.I)
    li = next((h for h, *_ in anchors(page) if re.search(r'linkedin\.com/company/(?!stellaris)[^/?#]+', h, re.I)), '')
    st = re.search(r'>\s*(Active|Inactive|Exited)\s*<', page)
    return {'name': name, 'website': website, 'year': int(yr.group(1)) if yr and 2000 <= int(yr.group(1)) <= NOW_YEAR else None,
            'people': founders_between(page, FOUNDERS_HEAD, r'Stellaris\s+Team|Partnered|Co-?investors?'),
            'linkedin_url': li.split('?')[0], 'status': st.group(1) if st else ''}


def collect_stellaris(refresh):
    base = SOURCES['stellaris']['page']
    listing = cached_text(os.path.join(SRC, 'stellaris', 'portfolio.html'), base, refresh, pause=INDIA_PAUSE)
    sm = cached_text(os.path.join(SRC, 'stellaris', 'sitemap.xml'), 'https://www.stellarisvp.com/sitemap.xml', refresh, pause=INDIA_PAUSE)
    cards = stellaris_listing(listing)
    pages, out, seen = DetailPages('stellaris'), [], set()
    for url, slug in re.findall(r'<loc>\s*(https?://[^<]*?/portfolio/([a-z0-9-]+))/?\s*</loc>', sm):
        if slug in seen: continue
        seen.add(slug)
        status, theme = cards.get(slug, ('', ''))
        if status and status != 'Active': continue       # Inactive or Exited: no row, no request
        page = pages.get(slug, url)
        if not page: continue
        d = parse_stellaris_detail(page)
        if (status or d['status']) != 'Active': continue  # status unknown on both pages: not taken
        name = d['name'] or slug.replace('-', ' ').title()
        out.append(india_candidate('stellaris', name, d['website'], theme.split(',')[0].strip(), url, d['people'], d['year'],
                                   d['linkedin_url'] if '/company/' in d['linkedin_url'] else ''))
    pages.report()
    return out


PRIME_NAME_KEYS = ('name', 'title', 'companyName', 'company_name')
PRIME_SITE_KEYS = ('website', 'websiteUrl', 'website_url', 'companyUrl', 'company_url', 'url', 'link', 'externalUrl', 'href')


def founder_names(v):
    """Founder names from a string ('Nipun Kohli, Srinivasan R'), a list of strings, or a list of {name: ...}."""
    if isinstance(v, str): return [clean(x) for x in re.split(r',|&|\band\b|\n', v) if clean(x)]
    if isinstance(v, list): return [n for x in v for n in founder_names(x.get('name', '') if isinstance(x, dict) else x)]
    return []


def prime_companies(listing):
    """[(name, website, founder names)] from the portfolio page: the Next.js payload first, else one card per heading."""
    found = {}

    def add(name, site, founders):
        name, d = clean(name), domain_of(site)
        if name and len(name) <= 60 and d and own_site(site) and d not in found: found[d] = (name, norm_url(site), founders)

    def walk(o):
        if isinstance(o, dict):
            name = next((o[k] for k in PRIME_NAME_KEYS if isinstance(o.get(k), str) and o[k].strip()), '')
            site = next((o[k] for k in PRIME_SITE_KEYS if isinstance(o.get(k), str) and re.match(r'(https?://|www\.)', o[k].strip())), '')
            if name and site: add(name, site, founder_names(o.get('founders') or o.get('founder') or o.get('founderNames') or ''))
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)

    for line in next_payload(listing).split('\n'):
        m = re.match(r'\s*[0-9a-f]+:(.*)$', line, re.S)
        if not m or m.group(1)[:1] not in ('[', '{'): continue
        try: walk(json.loads(m.group(1)))
        except ValueError: continue
    if not found:   # HTML fallback: each heading starts a card; its first outside link is the website
        heads = list(re.finditer(r'<h[2-4]\b[^>]*>(.*?)</h[2-4]>', listing, re.S | re.I))
        for i, h in enumerate(heads):
            card = listing[h.end():heads[i + 1].start() if i + 1 < len(heads) else len(listing)]
            site = next((x[0] for x in anchors(card) if re.match(r'https?://', x[0]) and own_site(x[0])), '')
            segs = segments(card)
            fi = next((j for j, s in enumerate(segs) if re.match(r'Founders?\b', s, re.I)), None)
            names = []
            if fi is not None:
                rest = re.sub(r'^Founders?\s*:?\s*', '', segs[fi], flags=re.I)
                names = founder_names(rest or (segs[fi + 1] if fi + 1 < len(segs) else ''))
            add(TAGS.sub(' ', h.group(1)), site, names)
    return list(found.values())


def collect_prime(refresh):
    base = SOURCES['prime']['page']
    listing = no_emails(cached_text(os.path.join(SRC, 'prime', 'portfolio.html'), base, refresh, pause=INDIA_PAUSE))
    return [india_candidate('prime', name, site, '', base, people_from_names(founders)) for name, site, founders in prime_companies(listing)]


HN_API = 'https://hn.algolia.com/api/v1/search_by_date'
LAUNCH_RE = re.compile(r'^Launch HN:\s*(.+?)\s*\((YC\s+)?([WSFX])\s?(\d{2})\)\s*[-–—:]*\s*(.*)$', re.I)
SHOW_RE = re.compile(r'^Show HN:\s*([A-Z0-9][\w.+\'’-]*(?: [A-Z0-9][\w.+\'’-]*){0,2})\s+[-–—:]+\s+(.{15,})$')


def hn_pages(tag, query, since, min_points, refresh, max_pages=12):
    """Newest first, paged by created_at_i (the API returns at most 1000 hits per query)."""
    hits, before = [], int(time.time()) + 86400
    for page in range(max_pages):
        nf = f'created_at_i>{since},created_at_i<{before}' + (f',points>={min_points}' if min_points else '')
        q = urllib.parse.urlencode({'query': query, 'tags': tag, 'numericFilters': nf, 'hitsPerPage': 1000, 'restrictSearchableAttributes': 'title'})
        text = cached_text(os.path.join(SRC, 'hacker-news', f'{tag}_{slugify(query)}_{page}.json'), HN_API + '?' + q, refresh, pause=1.2)
        got = json.loads(text).get('hits') or []
        hits += got
        if len(got) < 1000: break
        before = min(h['created_at_i'] for h in got)
    return hits


def collect_hn(refresh):
    out = []
    # Launch HN: every post is a YC company. It carries no website field, so it is matched to the YC index by name
    # and only ever adds a badge to a company that is already in the catalog.
    yc = load(os.path.join(CACHE, 'yc_all.json')) or []
    by_name = {}
    for c in yc: by_name.setdefault(re.sub(r'\W', '', c.get('name', '').lower()), []).append(c)
    season = {'W': 'Winter', 'S': 'Summer', 'F': 'Fall', 'X': 'Spring'}
    for h in hn_pages('story', '"Launch HN"', 1420070400, 0, refresh):
        m = LAUNCH_RE.match(clean(h.get('title')))
        if not m: continue
        name, batch = clean(m.group(1)), f'{season[m.group(3).upper()]} 20{m.group(4)}'
        cands = by_name.get(re.sub(r'\W', '', name.lower())) or []
        hit = next((c for c in cands if c.get('batch') == batch), cands[0] if len(cands) == 1 else None)
        year = int(h['created_at'][:4])
        out.append({'source': 'hacker-news', 'kind': 'launch', 'name': name, 'website': norm_url(hit.get('website')) if hit else '',
                    'yc_slug': hit['slug'].lower() if hit else '', 'description': '', 'sector': '', 'industry': None, 'location': '', 'country': '',
                    'active': True, 'source_url': f"https://news.ycombinator.com/item?id={h['objectID']}",
                    'badge': f'Launch HN {year}', 'year': year, 'people': [], 'linkedin_url': '', 'badge_only': True})
    # Show HN: well-received posts (100+ points, last three years) that link to the project's own domain.
    # Off by default: in the 2026-11 trial 379 posts gave 18 US sites, and most were side projects or open-source
    # libraries rather than companies. Pass --show-hn to collect them anyway.
    for h in (hn_pages('show_hn', '', int(time.time()) - 3 * 365 * 86400, 100, refresh) if '--show-hn' in sys.argv else []):
        m = SHOW_RE.match(clean(h.get('title')))
        url = norm_url(h.get('url'))
        if not m or not url or PLATFORM.search(domain_of(url)): continue
        p = urllib.parse.urlparse(url)
        year = int(h['created_at'][:4])
        out.append({'source': 'hacker-news', 'kind': 'show', 'name': clean(m.group(1)), 'website': f'{p.scheme}://{p.netloc}',
                    'description': '', 'sector': '', 'industry': None, 'location': '', 'country': '', 'active': True,
                    'source_url': f"https://news.ycombinator.com/item?id={h['objectID']}", 'badge': f'Show HN {year}', 'year': year,
                    'people': [], 'linkedin_url': '', 'points': h.get('points') or 0})
    return out


COLLECTORS = {'500-global': collect_500, 'antler': collect_antler, 'a16z': collect_a16z, 'sequoia': collect_sequoia, 'accel': collect_accel,
              'hacker-news': collect_hn, 'elevation': collect_elevation, 'stellaris': collect_stellaris, 'prime': collect_prime}
# 'yc-india' (collect_yc_india) is off: YC's Terms of Use forbid scraping, see SKIPPED


def collect(only, refresh=False):
    """Run each collector; one source failing never stops the others. cache/source_status.json records per source
    {state: ok|blocked|empty|failed, status, url, listed, at}: a blocked source is never reported as '0 companies'."""
    allc = load(os.path.join(CACHE, 'multi_candidates.json')) or {}
    status = load(os.path.join(CACHE, 'source_status.json')) or {}
    for slug, fn in COLLECTORS.items():
        if only and slug not in only: continue
        at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
        page = SOURCES.get(slug, {}).get('page', '')
        kept = len(allc.get(slug) or [])
        _detail_blocks.pop(slug, None)
        try:
            rows = fn(refresh)
            if rows:
                allc[slug] = rows
                st = {'state': 'ok', 'status': None, 'url': page, 'listed': len(rows), 'at': at}
                b = _detail_blocks.pop(slug, None)
                if b: st.update(state='blocked', status=b.status, url=b.url, note='detail pages blocked; rows parsed before the block are kept')
            else:      # an empty list is not "0 companies": the earlier rows stay until the source answers again
                st = {'state': 'empty', 'status': None, 'url': page, 'listed': 0, 'at': at, 'kept': kept}
            print(f'[collect] {slug}: {st["state"]}, {len(rows)} listed', flush=True)
        except Blocked as e:
            st = {'state': 'blocked', 'status': e.status, 'url': e.url, 'listed': 0, 'at': at, 'kept': kept}
            print(f'[collect] {slug}: BLOCKED ({e.status}) at {e.url} (keeping {kept} cached)', flush=True)
        except Exception as e:   # one source being down never stops the others
            st = {'state': 'failed', 'status': type(e).__name__, 'url': page, 'listed': 0, 'at': at, 'kept': kept, 'error': str(e)[:200]}
            print(f'[collect] {slug}: FAILED {type(e).__name__} {e} (keeping {kept} cached)', flush=True)
        status[slug] = st
    save(os.path.join(CACHE, 'multi_candidates.json'), allc)
    save(os.path.join(CACHE, 'source_status.json'), status)
    return allc


# ---------------------------------------------------------------- existing catalog (for dedupe)
_catalog = None


def catalog():
    global _catalog
    if _catalog is None: _catalog = _read_catalog()
    return _catalog


def _read_catalog():
    """domain -> slug for companies already in the public catalog, plus every slug in use.
    Read from the public site (sitemap) and the earlier scrape, never from the database."""
    try:
        sm = cached_text(os.path.join(CACHE, 'foundreach_sitemap.xml'), SITE_URL + '/sitemap-companies.xml', refresh='--refresh' in sys.argv)
    except Exception as e:
        print('sitemap unavailable:', e); sm = ''
    slugs = set(re.findall(r'<loc>[^<]*/companies/([a-z0-9_-]+)</loc>', sm))
    domains = {}
    for c in load(os.path.join(OUT, 'companies.json')) or []:
        m = re.search(r'ycombinator\.com/companies/([A-Za-z0-9_-]+)', c.get('notes') or '')
        slug = m.group(1).lower() if m else slugify(c['name'])
        slugs.add(slug)
        d = domain_of(c.get('website'))
        if d: domains.setdefault(d, slug)
    # Companies the daily cron added later: their website comes from the public YC index.
    for c in load(os.path.join(CACHE, 'yc_all.json')) or []:
        s = (c.get('slug') or '').lower()
        d = domain_of(c.get('website'))
        if s in slugs and d: domains.setdefault(d, s)
    # Anything still unknown (rows that never came from YC): the company's public page states its website.
    have = set(domains.values())
    for s in sorted(slugs - have):
        try:
            page = cached_text(os.path.join(CACHE, 'foundreach', s + '.html'), f'{SITE_URL}/companies/{s}', timeout=20, limit=400_000, pause=0.3)
        except Exception:
            continue
        m = re.search(r'"@type":"Organization","name":"(?:[^"\\]|\\.)*","url":"(https?:[^"]+)"', page)
        d = domain_of(m.group(1).replace('\\/', '/')) if m else ''
        if d and not PLATFORM.search(d): domains.setdefault(d, s)
    return domains, slugs


# ---------------------------------------------------------------- stage 2: the company's own website
_tls = threading.local()
_real_fetch = scrape.fetch


def _memo_fetch(url, *a, **kw):
    """Per-company memo so the three passes below never request the same page twice; keeps page texts for the US check."""
    memo = getattr(_tls, 'memo', None)
    if memo is None: return _real_fetch(url, *a, **kw)
    if url in memo:
        r = memo[url]
        if isinstance(r, Exception): raise r
        return r
    try:
        r = _real_fetch(url, *a, **kw)
    except Exception as e:
        memo[url] = e; raise
    memo[url] = r
    return r


scrape.fetch = _memo_fetch

STATES = {'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut',
          'DE': 'Delaware', 'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois',
          'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
          'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
          'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina',
          'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
          'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
          'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'}
STATE_BY_NAME = {v: k for k, v in STATES.items()}
ADDR = re.compile(r"([A-Z][A-Za-z.'’\- ]{2,40}),?\s+(%s|%s)\.?,?\s+(\d{5})(?:-\d{4})?(?!\d)" % ('|'.join(STATES), '|'.join(STATES.values())))
STREET = re.compile(r".*\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Suite|Ste|Floor|Fl|Unit|PMB|Box|Pkwy|Parkway|Hwy|Highway|"
                    r"Lane|Ln|Court|Ct|Plaza|Place|Pl|Square|Sq|Broadway|Building|Bldg|Level|Apt|Inc|LLC|Corp|Corporation|Co|No)\b\.?,?\s*(?:#?\d[\w-]{0,5}\s+)?\s*", re.S)
# Second halves of city names that the street stripping can leave behind.
CITY_FIX = {'Francisco': 'San Francisco', 'York': 'New York', 'Petersburg': 'St. Petersburg', 'Louis': 'St. Louis', 'Angeles': 'Los Angeles',
            'Alto': 'Palo Alto', 'Diego': 'San Diego', 'Jose': 'San Jose', 'Mateo': 'San Mateo', 'Monica': 'Santa Monica', 'Clara': 'Santa Clara',
            'Vegas': 'Las Vegas', 'Paul': 'St. Paul'}
# Registered-agent addresses: used by companies incorporated in the US but run from anywhere, so they prove nothing.
# Same for the two best-known virtual-mailbox towns.
AGENT = re.compile(r'^(Wilmington|Dover|Lewes|Middletown|Newark|Claymont),? DE$|^(Sheridan|Cheyenne),? WY$|^(Covina|Walnut),? CA$', re.I)
FOREIGN_CITY = re.compile(r'\b(London|Berlin|Paris|Tel[ -]Aviv|Bangalore|Bengaluru|Mumbai|Delhi|Gurgaon|Gurugram|Hyderabad|Toronto|Vancouver|Montreal|'
                          r'Singapore|Sydney|Melbourne|Amsterdam|Stockholm|Dublin|Tokyo|Seoul|Shanghai|Beijing|Shenzhen|Hong Kong|Zurich|Z[üu]rich|'
                          r'Munich|M[üu]nchen|Madrid|Barcelona|Lisbon|Copenhagen|Oslo|Helsinki|Tallinn|Warsaw|Prague|Vienna|Brussels|Dubai|'
                          r'Riyadh|Cairo|Lagos|Nairobi|Cape Town|Johannesburg|S[ãa]o Paulo|Mexico City|Bogot[áa]|Buenos Aires|Santiago|Jakarta|'
                          r'Bangkok|Manila|Kuala Lumpur|Ho Chi Minh|Taipei|Istanbul|Kyiv|Auckland|Edinburgh|Manchester|Cambridge, UK|Oxford|'
                          r'United Kingdom|Germany|France|Israel|India|Canada|Australia|Netherlands|Sweden|Ireland|Japan|Switzerland|Spain)\b')
FOREIGN_ENTITY = re.compile(r'(?:©|&copy;|\(c\)|copyright)[^<|]{0,80}?\b(Ltd\.?|Limited|GmbH|B\.V\.|S\.A\.S?\.?|Pty|Pvt|ApS|Oy|S\.L\.|SARL|K\.K\.|Pte|UG|AG|A/S|OÜ|s\.r\.o\.)(?=[\s.,|<]|$)', re.I)
CC_TLD = {'uk', 'de', 'fr', 'in', 'ca', 'au', 'il', 'sg', 'br', 'nl', 'se', 'es', 'it', 'jp', 'kr', 'cn', 'ch', 'ie', 'nz', 'mx', 'za', 'dk', 'no', 'fi',
          'pl', 'pt', 'at', 'be', 'ee', 'lt', 'lv', 'cz', 'ro', 'ru', 'ua', 'tr', 'ae', 'sa', 'hk', 'tw', 'id', 'my', 'th', 'vn', 'ph', 'ng', 'ke', 'eg',
          'pk', 'bd', 'ar', 'cl', 'pe', 'hu', 'gr', 'bg', 'hr', 'rs', 'si', 'sk', 'is', 'lu', 'eu', 'asia', 'africa', 'berlin', 'london', 'paris'}
THIRD_PARTY = re.compile(r'\b(Google|Alphabet|Meta|Facebook|Microsoft|Apple|Amazon|AWS|Stripe|Twitter|LinkedIn|Cloudflare|Mailchimp|Intuit|HubSpot|'
                         r'Salesforce|Zendesk|Slack|Twilio|SendGrid|Intercom|Hotjar|Vimeo|YouTube|OpenAI|Anthropic|Atlassian|Zoom|DocuSign|PayPal|'
                         r'Shopify|Segment|Mixpanel|Amplitude|Datadog|Sentry|GitHub|Vercel|Netlify|Heroku|Calendly|Typeform|Plaid|Square|Klaviyo|'
                         r'JAMS|Arbitration|Copyright Office|Copyright Agent|Trade Commission|FTC|Attorney General|Department of|Registered Agent|'
                         r'Better Business|TRUSTe|TrustArc|VeraSafe|Clerk|Auth0|Okta|Snowflake|Pinterest|TikTok|Snap|Reddit|Yahoo|Oracle|Adobe)\b', re.I)
OWN_CONTEXT = re.compile(r'contact|write to|mail|address|attn|attention|located|office|headquarter|principal place|reach us|\b(inc|llc|corp|co)\b\.?', re.I)
NOT_THE_COMPANY = re.compile(r'\b(you|your|users?|customers?|individuals?|residents?|persons?|subjects?|clients?|anyone|those|if|visitors?|people|'
                             r'investors?|entities|companies|partners?|team members?|employees?|candidates?|roles?|positions?)\b', re.I)
HQ_SAYS = re.compile(r"\b(?:headquartered|headquarters|based|HQ)\s+(?:is\s+|are\s+)?(?:out of|in)\s+((?:the\s+)?[A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+){0,2})(?:,\s*([A-Z]{2}\b|[A-Z][a-z]+(?: [A-Z][a-z]+)?))?")
PARKED = re.compile(r'domain (name )?(is|may be) for sale|buy this domain|this domain is parked|domain parking|sedoparking|hugedomains|'
                    r'afternic|dan\.com|website is under construction|account (has been )?suspended|this site can.t be reached', re.I)
META_DESC = [re.compile(r'<meta\b[^>]*?(?:name|property)=["\'](?:description|og:description|twitter:description)["\'][^>]*?content=["\']([^"\']{10,})["\']', re.I),
             re.compile(r'<meta\b[^>]*?content=["\']([^"\']{10,})["\'][^>]*?(?:name|property)=["\'](?:description|og:description|twitter:description)["\']', re.I)]
JUNK_DESC = re.compile(r'just another wordpress|coming soon|web site created using|lorem ipsum|^home$|page not found|enable javascript|'
                       r'access denied|^welcome to\b.{0,25}$|default description|description goes here', re.I)


def known_cities():
    """'City, ST' strings the catalog already uses, so own-site addresses land on the same spelling."""
    if not hasattr(known_cities, 'v'):
        full, names = set(), {}
        for c in load(os.path.join(OUT, 'companies.json')) or []:
            m = re.fullmatch(r"([A-Za-z.'’\- ]+), ([A-Z]{2})", (c.get('location') or '').strip())
            if m and m.group(2) in STATES:
                full.add(m.group(0)); names[m.group(1)] = names.get(m.group(1), 0) + 1
        known_cities.v = (full, {n for n, k in names.items() if k >= 3})
    return known_cities.v


def us_evidence(pages, host):
    """Decide from the company's own pages whether it is clearly US-based. Returns {us, city, why}."""
    full, common = known_cities()
    res = {'us': None, 'city': '', 'why': ''}
    tld = host.rsplit('.', 1)[-1] if host else ''
    if tld in CC_TLD: return {'us': False, 'city': '', 'why': f'country domain .{tld}'}
    us_hits, foreign = [], ''
    label = re.sub(r'[^a-z0-9]', '', host.split('.')[-2] if host.count('.') else host)
    for url, raw in pages:
        for cc in re.findall(r'"addressCountry"\s*:\s*(?:\{[^}]*?"name"\s*:\s*)?"([^"]{2,40})"', raw):
            if cc.strip().upper() in ('US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'):
                lo = re.search(r'"addressLocality"\s*:\s*"([A-Z][A-Za-z.\' -]{2,30})"', raw)
                rg = re.search(r'"addressRegion"\s*:\s*"([^"]{2,20})"', raw)
                st = rg and (rg.group(1) if rg.group(1) in STATES else STATE_BY_NAME.get(rg.group(1)))
                us_hits.append((f'{lo.group(1)}, {st}' if lo and st else '', 'schema.org addressCountry US', url, ''))
            else: foreign = foreign or f'schema.org addressCountry {cc.strip()}'
        text = re.sub(r'[ \t\r\f\v]+', ' ', html.unescape(TAGS.sub('\n', raw)))
        flat = re.sub(r'\s*\n\s*', ', ', text)
        flat = re.sub(r'(, )+', ', ', flat)
        m = FOREIGN_ENTITY.search(text)
        if m: foreign = foreign or f'copyright line names a {m.group(1)} entity'
        legal = bool(re.search(r'privacy|terms|legal|policy|tos\b', urllib.parse.urlparse(url).path, re.I))
        for m in ADDR.finditer(flat):
            before = flat[max(0, m.start() - 220):m.start() + len(m.group(1))]
            tp = THIRD_PARTY.search(before)
            if tp and tp.group(1).lower() not in label: continue           # a processor's or regulator's address, not the company's
            if legal and not (OWN_CONTEXT.search(before) or label in re.sub(r'[^a-z0-9]', '', before.lower())): continue
            st = m.group(2) if m.group(2) in STATES else STATE_BY_NAME[m.group(2)]
            city = m.group(1).split(',')[-1]
            city = STREET.sub('', ' ' + city + ' ').strip() if STREET.match(' ' + city + ' ') else city.strip()
            city = re.sub(r'^(?:\d+\w*\s+)+', '', city).strip(" .,-")
            words = city.split()
            for k in (3, 2, 1):   # prefer a spelling the catalog already has
                cand = ' '.join(words[-k:])
                if f'{cand}, {st}' in full: city = cand; break
            else:
                city = ' '.join(words[-2:]) if len(words) > 2 else city
            city = CITY_FIX.get(city, city)
            if not re.fullmatch(r"[A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+){0,2}", city): continue
            if city == 'New York City': city = 'New York'
            loc = f'{city}, {st}'
            if AGENT.match(loc): continue
            near = flat[max(0, m.start() - 300):m.end() + 300]
            fm = FOREIGN_CITY.search(near.replace(m.group(0), ' '))
            us_hits.append((loc, f'US address on {urllib.parse.urlparse(url).path or "/"}: {loc} {m.group(3)}', url, fm.group(1) if fm else ''))
        for m in HQ_SAYS.finditer('' if legal else text):   # legal pages talk about where "you" are based, not the company
            place, region = re.sub(r'^the\s+', '', m.group(1)), m.group(2) or ''
            if NOT_THE_COMPANY.search(text[max(0, m.start() - 60):m.start()]): continue
            if FOREIGN_CITY.fullmatch(place):
                foreign = foreign or f'site says based in {place}'
            elif region and FOREIGN_CITY.fullmatch(region):
                continue                                    # "based in New York, London and ..." is a list of offices
            elif region in STATES or region in STATE_BY_NAME:
                st = region if region in STATES else STATE_BY_NAME[region]
                us_hits.append((f'{place}, {st}', f'site says based in {place}, {st}', url, ''))
            elif place in common:
                loc = next((f for f in sorted(full) if f.startswith(place + ', ')), '')
                us_hits.append((loc, f'site says based in {place}', url, ''))
    if foreign: return {'us': False, 'city': '', 'why': foreign}
    if not us_hits: return res
    mixed = [h for h in us_hits if len(h) > 3 and h[3]]
    if mixed and len(mixed) == len(us_hits):
        return {'us': None, 'city': '', 'why': f'US address listed next to {mixed[0][3]} (offices in several countries)'}
    best = next((h for h in us_hits if h[0] and not (len(h) > 3 and h[3])), us_hits[0])
    return {'us': True, 'city': best[0], 'why': best[1]}


IN_CITIES = {'bengaluru': 'Bengaluru', 'bangalore': 'Bengaluru', 'mumbai': 'Mumbai', 'bombay': 'Mumbai', 'navi mumbai': 'Navi Mumbai',
             'new delhi': 'New Delhi', 'delhi': 'New Delhi', 'gurugram': 'Gurugram', 'gurgaon': 'Gurugram', 'noida': 'Noida',
             'greater noida': 'Greater Noida', 'faridabad': 'Faridabad', 'ghaziabad': 'Ghaziabad', 'hyderabad': 'Hyderabad',
             'secunderabad': 'Hyderabad', 'chennai': 'Chennai', 'madras': 'Chennai', 'pune': 'Pune', 'kolkata': 'Kolkata',
             'calcutta': 'Kolkata', 'ahmedabad': 'Ahmedabad', 'gandhinagar': 'Gandhinagar', 'jaipur': 'Jaipur', 'kochi': 'Kochi',
             'cochin': 'Kochi', 'chandigarh': 'Chandigarh', 'mohali': 'Mohali', 'indore': 'Indore', 'coimbatore': 'Coimbatore',
             'thane': 'Thane', 'surat': 'Surat', 'vadodara': 'Vadodara', 'lucknow': 'Lucknow', 'bhubaneswar': 'Bhubaneswar',
             'thiruvananthapuram': 'Thiruvananthapuram', 'trivandrum': 'Thiruvananthapuram', 'nagpur': 'Nagpur', 'mysuru': 'Mysuru',
             'mysore': 'Mysuru', 'visakhapatnam': 'Visakhapatnam', 'bhopal': 'Bhopal', 'mangaluru': 'Mangaluru', 'mangalore': 'Mangaluru'}
IN_CITY = re.compile(r'\b(%s)\b' % '|'.join(sorted((re.escape(c) for c in IN_CITIES), key=len, reverse=True)), re.I)
IN_PIN = re.compile(r'(?<![\d+\-])\b[1-9]\d{5}\b(?![\d\-])')
IN_COUNTRY = {'IN', 'IND', 'INDIA'}
IN_ENTITY = re.compile(r'(?:©|&copy;|\(c\)|copyright)[^<\n|]{0,120}?\b(Private\s+Limited|Pvt\.?\s*Ltd\.?)', re.I)


def in_city(s):
    """'Bangalore' -> 'Bengaluru', 'Gurgaon' -> 'Gurugram', 'Delhi' -> 'New Delhi'; '' when the place is not a known Indian city."""
    m = IN_CITY.fullmatch(clean(s)) if s else None
    return IN_CITIES[m.group(1).lower()] if m else ''


def enclosing_object(raw, start, end, reach=4000):
    """The JSON object text around raw[start:end]: from its own '{' to its matching '}', skipping nested objects on either side.
    '' when no balanced object is found within `reach` characters. Braces inside strings are rare in JSON-LD and not handled."""
    depth, i, lo = 0, start - 1, -1
    while i >= max(0, start - reach):
        c = raw[i]
        if c == '}': depth += 1
        elif c == '{':
            if depth == 0: lo = i; break
            depth -= 1
        i -= 1
    if lo < 0: return ''
    i, stop = end, min(len(raw), end + reach)
    # the matched text may hold an opened nested object ({"@type":"Country","name":"IN"}) that is still open at `end`
    depth = raw[start:end].count('{') - raw[start:end].count('}')
    while i < stop:
        c = raw[i]
        if c == '{': depth += 1
        elif c == '}':
            if depth == 0: return raw[lo:i + 1]
            depth -= 1
        i += 1
    return ''


def india_evidence(pages, host):
    """Does the company's own site state an address in India? Returns {india: True|None, city, why}. Any one counts:
    (a) schema.org addressCountry IN/India (city = addressLocality); (b) a known Indian city within 80 characters of a 6-digit PIN;
    (c) 'Private Limited' / 'Pvt. Ltd.' in a copyright line, together with a .in host or a known Indian city on the same page.
    A city alone or a domain alone is never evidence. Phone numbers are never read and nothing but the city is kept."""
    host = (host or '').lower()
    found = []          # (rank, city, why): a stated address beats a city seen near the copyright
    for url, raw in pages:
        path = urllib.parse.urlparse(url).path or '/'
        for m in re.finditer(r'"addressCountry"\s*:\s*(?:\{[^}]*?"name"\s*:\s*)?"([^"]{2,40})"', raw or ''):
            if m.group(1).strip().upper() not in IN_COUNTRY: continue
            # the locality of this address only: another office's addressLocality nearby is never read
            win = enclosing_object(raw, m.start(), m.end())
            lo = re.search(r'"addressLocality"\s*:\s*"([^"]{2,40})"', win) if win else None
            loc = clean(lo.group(1)) if lo else ''
            city = in_city(loc) or (loc if re.fullmatch(r"[A-Z][A-Za-z.' -]{2,30}", loc) else '')
            found.append((0, city, 'schema.org addressCountry ' + m.group(1).strip()))
        text = re.sub(r'\s+', ' ', html.unescape(TAGS.sub(' ', raw or '')))
        for m in IN_CITY.finditer(text):
            near = text[max(0, m.start() - 80):m.end() + 80]
            if IN_PIN.search(near):
                found.append((1, IN_CITIES[m.group(1).lower()], f'Indian address with a PIN code on {path}'))
                break
        e = IN_ENTITY.search(html.unescape(raw or ''))
        if e:
            c = IN_CITY.search(text)
            if host.endswith('.in') or c:
                found.append((2, IN_CITIES[c.group(1).lower()] if c else '',
                              f'copyright names a {clean(e.group(1))} entity' + (' on a .in domain' if host.endswith('.in') else ' with an Indian city')))
    if not found: return {'india': None, 'city': '', 'why': ''}
    found.sort(key=lambda x: x[0])
    return {'india': True, 'city': next((f[1] for f in found if f[1]), ''), 'why': found[0][2]}


SPAM = re.compile(r'casino|pokies|\bslot\s?(gacor|777|online|qris)|\btogel\b|\bjudi\b|sportsbook|jackpot|\bbandar\b|\bporn|escorts?\b|viagra|xoilac|b[oó]ng đ[aá]', re.I)


def brand_of(final_url, text):
    """What the homepage calls itself (title, site name, logo alt texts, first screen of text) and where it finally landed."""
    bits = [m for rx in (r'<title[^>]*>(.*?)</title>', r'<meta\b[^>]*?(?:property|name)=["\'](?:og:site_name|application-name|og:title)["\'][^>]*?content=["\']([^"\']+)',
                         r'<meta\b[^>]*?content=["\']([^"\']+)["\'][^>]*?(?:property|name)=["\'](?:og:site_name|application-name|og:title)["\']')
            for m in re.findall(rx, text[:400000], re.S | re.I)]
    bits += re.findall(r'\balt=["\']([^"\']{2,80})["\']', text[:400000])[:40]
    bits.append(TAGS.sub(' ', text)[:6000])
    bits += re.findall(r'(?:©|&copy;|copyright)[^<]{0,120}', text, re.I)[:3]
    brand = re.sub(r'[^a-z0-9]+', ' ', clean(' '.join(bits)).lower()).strip()[:5000]
    names = []
    for b in bits[:-1][:8]:
        for part in re.split(r'\s+[|–—·:-]+\s+|\s*\|\s*', clean(TAGS.sub(' ', b))):
            part = re.sub(r'\s+(logo|home|homepage)$', '', part.strip(), flags=re.I)
            if 2 <= len(part) <= 60 and part not in names: names.append(part)
    return {'brand': brand, 'names': names[:20], 'final_host': base_domain(urllib.parse.urlparse(final_url or '').netloc)}


def same_company(name, website, f):
    """Old portfolio domains get sold or redirected. Keep a site only if it still presents itself under the company's name."""
    if f.get('final_host') and PLATFORM.search(f['final_host']): return False
    if SPAM.search((f.get('title') or '') + ' ' + (f.get('description') or '')): return False
    brand = f.get('brand') or ''
    if len(brand) < 30: return None          # nothing readable (script-only page): cannot tell
    squashed = brand.replace(' ', '')
    n = re.sub(r'[^a-z0-9]', '', name.lower())
    toks = [re.sub(r'[^a-z0-9]', '', t.lower()) for t in re.split(r'[\s.,/()&+-]+', name)]
    label = re.sub(r'[^a-z0-9]', '', domain_of(website).split('.')[0])
    return bool((n and n in squashed) or any(len(t) >= 4 and t in squashed for t in toks) or (len(label) >= 4 and label in squashed))


def canon_location(loc):
    """Spell a 'City, ST' the way the catalog already does ('San Francisco', 'New York City, NY', 'Boston')."""
    if not hasattr(canon_location, 'v'):
        n = {}
        for c in load(os.path.join(OUT, 'companies.json')) or []:
            l = (c.get('location') or '').strip()
            if l: n[l] = n.get(l, 0) + 1
        canon_location.v = n
    n = canon_location.v
    m = re.fullmatch(r'(.+), ([A-Z]{2})', loc or '')
    if not m: return loc or ''
    if AGENT.match(loc): return ''          # a registered agent's town says nothing about where the team is
    city, st = m.groups()
    if city in CITY_FIX: city = CITY_FIX[city]; loc = f'{city}, {st}'
    if st == 'NY' and city in ('New York', 'New York City', 'Manhattan'): return 'New York City, NY'
    return city if n.get(city, 0) > max(n.get(loc, 0), 2) else loc


def facts_job(key, website, need_us, need_in=False):
    """site_scan + deep_job (existing enrichment) and a facts pass over the same pages. One company = one worker, pages fetched once.
    need_in: also look for an Indian address (india_evidence). A cached fact without it is redone, unless the site is dead or US."""
    path = os.path.join(FACTS, key + '.json')
    old = load(path)
    in_done = old is not None and (old.get('in_checked') or not need_in or not old.get('ok') or old.get('us') is True)
    if old is not None and (old.get('us_checked') or not need_us) and in_done:
        if 'names' in old or not old.get('ok'): return 'cached'
        try:   # written before the identity check existed: one homepage request adds it
            final, text = _real_fetch(website if re.match(r'https?://', website) else 'https://' + website, timeout=14, strict=False)
            old.update(brand_of(final, text))
        except Exception:
            old.update({'brand': old.get('brand', ''), 'names': [], 'final_host': old.get('final_host', '')})
        save(path, old)
        return 'upgraded'
    _tls.memo = {}
    try:
        spath, dpath = os.path.join(CACHE, 'sites', key + '.json'), os.path.join(CACHE, 'deep', key + '.json')
        s = load(spath)
        if s is None:
            s = scrape.site_scan(website); save(spath, s)
        res = {'ok': bool(s.get('ok')), 'error': s.get('error', ''), 'description': '', 'title': '', 'parked': False, 'us': None, 'city': '', 'why': '',
               'us_checked': bool(need_us), 'india': None, 'india_city': '', 'india_why': '', 'in_checked': bool(need_in)}
        if not s.get('ok'):
            save(path, res); return 'dead'
        host = s.get('host') or domain_of(website)
        own = [e for e in s.get('emails') or [] if e.split('@')[1].endswith(host)]
        need = [k for k, miss in (('contact', not strict_contact(s.get('contact_url'))), ('email', not own), ('careers', not s.get('careers_url')), ('logo', True)) if miss]
        if not os.path.exists(dpath): scrape.deep_job(key, website, need)
        url = website if re.match(r'https?://', website) else 'https://' + website
        pages = [(u, r[1]) for u, r in _tls.memo.items() if not isinstance(r, Exception)]
        home = next((r for u, r in _tls.memo.items() if u == url and not isinstance(r, Exception)), None)
        if home is None:   # site_scan came from an older cache: read the homepage once
            try: home = scrape.fetch(url, timeout=14, strict=False); pages.append((url, home[1]))
            except Exception: home = ('', '')
        text = home[1]
        res.update(brand_of(home[0], text))
        for rx in META_DESC:
            for d in rx.findall(text):
                d = clean(d)
                if 25 <= len(d) and not JUNK_DESC.search(d) and not scrape.EMAIL.search(d): res['description'] = d[:400]; break
            if res['description']: break
        t = re.search(r'<title[^>]*>(.*?)</title>', text, re.S | re.I)
        res['title'] = clean(TAGS.sub(' ', t.group(1)))[:160] if t else ''
        res['parked'] = bool(PARKED.search(text[:60000])) or len(TAGS.sub(' ', text).strip()) < 40 and 'script' not in text.lower()
        ev = us_evidence(pages, host)
        iev = india_evidence(pages, host) if need_in else {'india': None, 'city': '', 'why': ''}
        us_open = lambda: need_us and ev['us'] is None and not ev['why']
        in_open = lambda: need_in and iev['india'] is None and ev['us'] is not True
        if us_open() or in_open():
            base = home[0] or url
            for p in ['/about', '/contact', '/privacy', '/privacy-policy', '/terms', '/company', '/about-us', '/legal/privacy', '/terms-of-service']:
                full = urllib.parse.urljoin(base, p)
                if full in _tls.memo: continue
                try: f2, t2 = scrape.fetch(full, timeout=10, limit=800_000, strict=False)
                except Exception: continue
                if urllib.parse.urlparse(f2).path.rstrip('/') == '': continue
                if us_open():
                    e2 = us_evidence([(f2, t2)], host)
                    if e2['us'] is not None or e2['why']: ev = e2
                if in_open():
                    i2 = india_evidence([(f2, t2)], host)
                    if i2['india']: iev = i2
                if not us_open() and not in_open(): break
        res.update(ev)
        res.update({'india': iev['india'], 'india_city': iev['city'], 'india_why': iev['why']})
        save(path, res)
        return 'ok'
    finally:
        _tls.memo = None


CONTACT_SEGMENTS = {'contact', 'contact-us', 'contactus', 'get-in-touch', 'support', 'help'}


def strict_contact(u):
    """A contact page has a path segment that is exactly contact, contact-us, contactus, get-in-touch, support or help."""
    if not u: return ''
    try: p = urllib.parse.urlparse(u)
    except ValueError: return ''
    return u if p.scheme in ('http', 'https') and any(seg in CONTACT_SEGMENTS for seg in p.path.lower().split('/')) else ''


def to_enrich(allc, only, domains):
    """Unique new-to-catalog websites worth a visit: listed as US (or location unknown), still operating, own domain."""
    jobs = {}
    for slug, cands in allc.items():
        if only and slug not in only: continue
        if slug not in COLLECTORS: continue   # a source switched off (yc-india) left in the candidates cache: no site visits
        for c in cands:
            d = domain_of(c.get('website'))
            if not d or c.get('badge_only') or not c.get('active') or c.get('country') == 'other' or d in domains or PLATFORM.search(d): continue
            key = site_key(c['website'])
            need_us = c.get('country') not in ('US', 'IN')     # the source already states the country
            need_in = c.get('country') == 'IN' or slug in INDIA_SITE_SOURCES   # city for Indian rows; India for the India portfolios
            if key in jobs:   # listed by several sources: one visit answers every question asked
                _, site, u, i = jobs[key]
                jobs[key] = (key, site, u or need_us, i or need_in)
            else: jobs[key] = (key, c['website'], need_us, need_in)
    return list(jobs.values())


def enrich(allc, only, limit=None):
    domains, _ = catalog()
    jobs = to_enrich(allc, only, domains)[:limit]
    print(f'[enrich] {len(jobs)} websites', flush=True)
    run(jobs, facts_job, 16, 'enrich')


# ---------------------------------------------------------------- stage 3: build
SOURCE_ORDER = ['yc-india', 'a16z', 'sequoia', 'elevation', 'stellaris', 'prime', 'accel', '500-global', 'antler', 'hacker-news']   # which listing names the row when several list it
COUNTRY_NAME = {'US': 'United States', 'IN': 'India'}     # the row's `country`, read by ingest_catalog (migration 202611260001)


def build(allc, only):
    domains, slugs = catalog()
    taken = set(slugs)
    rows, by_domain, badge_adds = [], {}, {}
    stats, row_src = {}, {}
    S = lambda slug: stats.setdefault(slug, {'listed': 0, 'no_website': 0, 'not_us': 0, 'not_operating': 0, 'us_and_active': 0, 'in_catalog': 0,
                                             'location_unknown': 0, 'site_down': 0, 'site_parked': 0, 'site_not_the_company': 0, 'no_description': 0,
                                             'duplicate_of_other_source': 0, 'new': 0, 'india_from_site': 0})
    # only sources that are still collected: a stale candidates cache cannot bring back a source that was switched off
    order = [s for s in SOURCE_ORDER if s in allc and s in COLLECTORS] + [s for s in allc if s not in SOURCE_ORDER and s in COLLECTORS]
    for slug in order:
        if only and slug not in only: continue
        meta = SOURCES[slug]
        for c in allc[slug]:
            st = S(slug); st['listed'] += 1
            badge = {'label': c['badge'], 'source': c.get('badge_source') or slug}
            d = domain_of(c.get('website'))
            if c.get('badge_only'):
                # Launch HN: only ever a badge on a company that is already listed.
                target = c.get('yc_slug') if c.get('yc_slug') in slugs else domains.get(d)
                if target:
                    st['in_catalog'] += 1
                    badge_adds.setdefault(target, {'slug': target, 'domain': d, 'badge_only': True, 'badges': []})
                    if badge not in badge_adds[target]['badges']: badge_adds[target]['badges'].append(badge)
                else: st['launch_not_in_catalog'] = st.get('launch_not_in_catalog', 0) + 1   # non-US, inactive, or name not matched to the YC index
                continue
            if not d or PLATFORM.search(d): st['no_website'] += 1; continue
            if c.get('country') == 'other': st['not_us'] += 1; continue
            if not c.get('active'): st['not_operating'] += 1; continue
            if d in domains:
                st['in_catalog'] += 1
                if c.get('country') == 'US': st['us_and_active'] += 1
                t = domains[d]
                badge_adds.setdefault(t, {'slug': t, 'domain': d, 'badge_only': True, 'badges': []})
                if badge not in badge_adds[t]['badges']: badge_adds[t]['badges'].append(badge)
                continue
            key = site_key(c['website'])
            f = load(os.path.join(FACTS, key + '.json'))
            if f is None: st['site_down'] += 1; continue   # not visited yet (run the enrich stage)
            cc, from_site = c.get('country') or '', False
            if not cc and f.get('india') is True and f.get('us') is not True:
                cc, from_site = 'IN', True                 # no country from the source; the company's own site states India
            if cc == 'IN':
                pass                                       # India is stated: no US check; the site gates below still apply
            elif cc != 'US':
                if f.get('us') is False: st['not_us'] += 1; continue
                if f.get('us') is True and AGENT.match(f.get('city') or '') and 'US address' in f.get('why', ''):
                    st['location_unknown'] += 1; continue      # only a registered-agent / virtual-mailbox address
                if f.get('us') is not True:
                    if f.get('ok'): st['location_unknown'] += 1
                    else: st['site_down'] += 1
                    continue
            elif f.get('us') is False and 'country domain' in f.get('why', ''):
                st['not_us'] += 1; continue      # listed as US, but the company's site lives on another country's domain
            st['us_and_active'] += 1
            if not f.get('ok'): st['site_down'] += 1; continue
            if f.get('parked'): st['site_parked'] += 1; continue
            same = same_company(c['name'], c['website'], f)
            if same is False or (same is None and not clean(c.get('description'))): st['site_not_the_company'] += 1; continue
            desc = clean(c.get('description')) or clean(f.get('description'))
            desc = clean(scrape.EMAIL.sub('', desc))
            letters = re.findall(r'[^\W\d_]', desc)
            if len(desc) < 15 or sum(1 for ch in letters if ord(ch) > 0x24F) > 0.2 * max(1, len(letters)): st['no_description'] += 1; continue   # none, or not in English
            if d in by_domain:
                st['duplicate_of_other_source'] += 1
                row = by_domain[d]
                if badge not in row['badges']: row['badges'].append(badge)
                if not row['people'] and c.get('people'): row['people'] = c['people']
                for k in ('sector', 'industry'):
                    if not row.get(k) and c.get(k): row[k] = c[k]
                continue
            s = load(os.path.join(CACHE, 'sites', key + '.json')) or {}
            dp = load(os.path.join(CACHE, 'deep', key + '.json')) or {}
            host = s.get('host') or dp.get('host') or d
            emails = [e for e in dict.fromkeys((s.get('emails') or []) + (dp.get('emails') or [])) if not BAD_EMAIL.search(e)]
            general, hiring = pick_emails(emails, host) if emails else ('', '')
            careers = s.get('careers_url') or dp.get('careers_url') or ''
            if re.search(r'rippling\.com/(?!.*jobs)|/blog/', careers) or scrape.EMAIL.search(careers): careers = ''
            li = c.get('linkedin_url') or s.get('linkedin_url') or ''
            li = li if re.match(r'https?://([a-z0-9-]+\.)*linkedin\.com/company/[^/?#]+', li, re.I) else ''
            base = slugify(c['name'])[:80] or slugify(d.split('.')[0]) or 'company'
            cand, n = base, 1
            if cand in taken:
                cand = f'{base}-{slugify(d.split(".")[0])}'[:90]
                root = cand
                while cand in taken:
                    n += 1; cand = f'{root}-{n}'
            taken.add(cand)
            people = []
            for p in c.get('people') or []:
                pl = p.get('linkedin_url') or ''
                people.append({**{k: v for k, v in p.items() if k != 'email'},   # people never carry an email
                               'linkedin_url': pl if re.match(r'https?://([a-z0-9-]+\.)*linkedin\.com/in/[^/?#]+', pl, re.I) else ''})
            notes = [meta['name'] + (f" {c['year']}" if c.get('year') else ''), c['source_url']]
            if from_site: notes.append('India check: ' + f.get('india_why', ''))
            elif cc not in ('US', 'IN'): notes.append('US check: ' + f.get('why', ''))
            row = {'slug': cand, 'domain': d, 'name': site_casing(c['name'], f)[:200], 'website': norm_url(c['website']),
                   'description': desc[:600],
                   # an Indian row's city comes from its source, else from the site's Indian address; never from the US-address check
                   'location': (clean(c.get('location')) or clean(f.get('india_city'))) if cc == 'IN' else canon_location(f.get('city') or ''),
                   'sector': c.get('sector') or '', 'industry': c.get('industry') or '',
                   'logo_url': c.get('logo_url') or dp.get('logo_url') or '', 'careers_url': careers or c.get('careers_url') or '',
                   'contact_url': strict_contact(s.get('contact_url')) or strict_contact(dp.get('contact_url')),
                   'linkedin_url': li.split('?')[0], 'contact_email': general, 'hiring_email': hiring,
                   'source': meta['name'], 'source_url': c['source_url'], 'badges': [badge], 'batch_year': c.get('year'),
                   'notes': ' · '.join(x for x in notes if x), 'people': people,
                   'country': COUNTRY_NAME['IN' if cc == 'IN' else 'US']}
            by_domain[d] = row
            row_src[id(row)] = slug
            rows.append(row)
            st['new'] += 1
            if from_site: st['india_from_site'] += 1
    for slug in stats:
        mine = [r for r in rows if row_src.get(id(r)) == slug]
        cov = lambda k: sum(1 for r in mine if r.get(k))
        stats[slug]['coverage_of_new'] = {'description': cov('description'), 'city': cov('location'), 'leaders': cov('people'), 'careers': cov('careers_url'),
                                         'contact': cov('contact_url'), 'email': sum(1 for r in mine if r['contact_email'] or r['hiring_email']),
                                         'linkedin': cov('linkedin_url'), 'logo': cov('logo_url'), 'industry': cov('industry')}
    adds = list(badge_adds.values())
    summary = {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
               'new_companies': len(rows), 'badge_adds': len(adds), 'catalog_domains_known': len(domains), 'catalog_slugs_known': len(slugs),
               'per_source': stats, 'sources': {k: {**v} for k, v in SOURCES.items()}, 'skipped_sources': SKIPPED,
               'source_status': load(os.path.join(CACHE, 'source_status.json')) or {}}
    save(os.path.join(OUT, 'companies_multi.json'), {'summary': summary, 'rows': rows + adds})
    print(json.dumps({k: v for k, v in summary.items() if k not in ('sources', 'skipped_sources')}, indent=1))
    return summary


def main():
    stage = sys.argv[1] if len(sys.argv) > 1 else 'all'
    arg = lambda f: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else None
    only = set(arg('--only').split(',')) if arg('--only') else None
    limit = int(arg('--limit')) if arg('--limit') else None
    if stage in ('collect', 'all'): allc = collect(only, '--refresh' in sys.argv)
    else: allc = load(os.path.join(CACHE, 'multi_candidates.json')) or {}
    if stage in ('enrich', 'all'): enrich(allc, only, limit)
    if stage in ('build', 'all'): build(allc, only)


if __name__ == '__main__':
    main()
