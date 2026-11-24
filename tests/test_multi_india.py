"""Founder task #2 (India): pure helpers and the build gate in scraper/multi.py.

Run from the repository root:  python3 -m unittest discover -s tests -p 'test_multi_india.py'
No network: the catalog lookup is replaced and every cache path points at a temporary folder.
Fixtures are built from the Razorpay and RedCarpetUp sample records in research.md.
"""
import json, os, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scraper'))
import multi  # noqa: E402

RAZORPAY = {"name": "Razorpay", "slug": "razorpay", "website": "https://razorpay.com", "all_locations": "Bengaluru, KA, India",
            "one_liner": "India's only full-stack financial solutions company for businesses.", "industry": "Fintech",
            "subindustry": "Fintech -> Payments", "batch": "Winter 2015", "status": "Active", "isHiring": True, "team_size": 2700,
            "regions": ["India", "South Asia", "Remote", "Partly Remote"],
            "small_logo_thumb_url": "https://bookface-images.s3.amazonaws.com/small_logos/b6a6aaf9a84fa4b7ddb53cabda7443c142a5a154.png",
            "url": "https://www.ycombinator.com/companies/razorpay"}
REDCARPET = {"name": "RedCarpetUp", "slug": "redcarpetup", "website": "http://redcarpetup.com", "all_locations": "Gurugram, HR, India; Remote",
             "one_liner": "Credit cards for Indians that banks cannot see", "industry": "Fintech", "subindustry": "Fintech -> Consumer Finance",
             "batch": "Summer 2015", "status": "Active", "isHiring": False, "team_size": 100,
             "regions": ["India", "South Asia", "Remote", "Fully Remote"], "url": "https://www.ycombinator.com/companies/redcarpetup"}
FOUNDERS = [{"name": "Harshil Mathur", "title": "CEO", "linkedin_url": "linkedin.com/in/harshilmathur", "email": "x@y.com"}]


class Helpers(unittest.TestCase):
    def test_yc_city(self):
        self.assertEqual(multi.yc_city("Bengaluru, KA, India"), "Bengaluru")
        self.assertEqual(multi.yc_city("Gurugram, HR, India; Remote"), "Gurugram")
        self.assertEqual(multi.yc_city("Remote"), "")
        self.assertEqual(multi.yc_city(""), "")
        self.assertEqual(multi.yc_city(None), "")

    def test_is_yc_india(self):
        c = {"regions": ["India"], "status": "Active", "all_locations": "Bengaluru, KA, India"}
        self.assertTrue(multi.is_yc_india(c))
        self.assertFalse(multi.is_yc_india({**c, "all_locations": "San Francisco, CA, USA; Bengaluru, KA, India"}))
        self.assertFalse(multi.is_yc_india({**c, "status": "Inactive"}))
        self.assertFalse(multi.is_yc_india({**c, "regions": ["United States of America"]}))
        self.assertTrue(multi.is_yc_india({**c, "status": "Public"}))
        self.assertTrue(multi.is_yc_india(RAZORPAY) and multi.is_yc_india(REDCARPET))

    def test_yc_people(self):
        p = multi.yc_people(FOUNDERS)
        self.assertEqual(len(p), 1)
        self.assertEqual((p[0]["first_name"], p[0]["last_name"], p[0]["role"]), ("Harshil", "Mathur", "CEO"))
        self.assertEqual(p[0]["linkedin_url"], "https://linkedin.com/in/harshilmathur")
        self.assertNotIn("email", p[0])
        self.assertEqual(multi.yc_people([{**FOUNDERS[0], "linkedin_url": "https://www.linkedin.com/company/razorpay"}])[0]["linkedin_url"], "")
        self.assertEqual(multi.yc_people([{"name": "", "title": "CEO"}, {"name": "a@b.com"}]), [])
        self.assertEqual(multi.yc_people([{**FOUNDERS[0], "active": False}]), [])

    def test_antler_country(self):
        self.assertEqual(multi.antler_country("India"), "IN")
        self.assertEqual(multi.antler_country("india"), "IN")
        self.assertEqual(multi.antler_country("USA"), "US")
        self.assertEqual(multi.antler_country("Singapore"), "other")
        self.assertEqual(multi.antler_country(""), "")

    def test_yc_batch(self):
        self.assertEqual(multi.yc_batch("Winter 2015"), ("YC W15", 2015))
        self.assertEqual(multi.yc_batch("Spring 2025"), ("YC X25", 2025))
        self.assertEqual(multi.yc_batch(""), ("Y Combinator", None))

    def test_yc_india_not_collected(self):
        # YC's Terms of Use forbid scraping: the collector is off and the reason is recorded.
        self.assertNotIn("yc-india", multi.COLLECTORS)
        self.assertIn("yc-india", multi.SKIPPED)
        self.assertIn("data mining, robots, scraping", multi.SKIPPED["yc-india"])
        self.assertIn("NOT collected", multi.SOURCES["yc-india"]["policy"])
        self.assertIn("antler", multi.COLLECTORS)

    def test_yc_candidate(self):
        c = multi.yc_candidate(RAZORPAY, {"founders": FOUNDERS, "linkedin_url": "linkedin.com/company/razorpay", "country": "IN"})
        self.assertEqual((c["country"], c["location"], c["badge"], c["badge_source"], c["year"]), ("IN", "Bengaluru", "YC W15", "yc", 2015))
        self.assertEqual(c["industry"], "Fintech")
        self.assertEqual(c["sector"], "Payments")
        self.assertEqual(c["linkedin_url"], "https://linkedin.com/company/razorpay")
        self.assertTrue(c["logo_url"].startswith("https://bookface-images"))
        self.assertEqual(c["careers_url"], "https://www.ycombinator.com/companies/razorpay/jobs")
        self.assertNotIn("@", json.dumps(c["people"]))


class BuildGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        self.saved = (multi.CACHE, multi.OUT, multi.FACTS, multi._catalog)
        multi.CACHE, multi.OUT, multi.FACTS = os.path.join(t, 'cache'), os.path.join(t, 'out'), os.path.join(t, 'facts')
        multi._catalog = ({}, set())
        if hasattr(multi.canon_location, 'v'): del multi.canon_location.v

    def tearDown(self):
        multi.CACHE, multi.OUT, multi.FACTS, multi._catalog = self.saved
        if hasattr(multi.canon_location, 'v'): del multi.canon_location.v
        self.tmp.cleanup()

    def facts(self, website, **kw):
        f = {'ok': True, 'parked': False, 'us': None, 'why': '', 'city': '', 'description': '', 'brand': '', 'names': [], 'final_host': '', **kw}
        multi.save(os.path.join(multi.FACTS, multi.site_key(website) + '.json'), f)

    def antler(self, name, website, country, location='', description='', **kw):
        return {'source': 'antler', 'name': name, 'website': website, 'description': description, 'sector': 'Fintech', 'industry': None,
                'location': location, 'country': country, 'active': True, 'source_url': 'https://www.antler.co/portfolio',
                'badge': 'Antler 2024', 'year': 2024, 'people': [], 'linkedin_url': '', **kw}

    def test_india_rows_kept_without_us_evidence(self):
        # Criterion 3: an Indian row takes its city from the source, never from the site's US-address check.
        blr = self.antler('Paytrail', 'https://paytrail.example', 'IN', 'Bengaluru', 'Payments for small shops across India.',
                          people=[{'first_name': 'Asha', 'last_name': 'Rao', 'role': 'CEO', 'linkedin_url': 'https://www.linkedin.com/in/asharao',
                                   'email': 'asha@paytrail.example'}])
        self.facts(blr['website'], brand='paytrail payments for small shops ' * 2, city='San Francisco, CA', us=True, why='US address')
        # Criterion 4: no city from the source -> no city, even when the site lists a US office.
        nocity = self.antler('Lendkart', 'https://lendkart.example', 'IN', '', 'Loans for small businesses in India.')
        self.facts(nocity['website'], brand='lendkart loans for small businesses ' * 2, city='San Francisco, CA', us=True, why='US address')
        # Criterion 5: a US row keeps the old expression, canon_location(f['city']).
        us = self.antler('Acme', 'https://acme.example', 'US', '', 'Payments for small shops in Texas.',
                         people=[{'first_name': 'Jo', 'last_name': 'Doe', 'role': 'CEO', 'linkedin_url': '', 'email': 'jo@acme.example'}])
        self.facts(us['website'], brand='acme payments for small shops ' * 2, city='Austin, TX', us=True, why='US address')
        # Site gates still apply to Indian rows.
        parked = self.antler('Parked', 'https://parked.example', 'IN', 'Pune', 'Credit cards for Indians that banks cannot see.')
        self.facts(parked['website'], parked=True)
        nodesc = self.antler('Nodesc', 'https://nodesc.example', 'IN', 'Pune', '')
        self.facts(nodesc['website'], brand='nodesc ' * 10)
        other = self.antler('Sing', 'https://sing.example', 'other', '', 'Payments for shops in Singapore.')
        # Criterion 6: candidates cached under yc-india (switched off) are ignored.
        rp = multi.yc_candidate(RAZORPAY, {"founders": FOUNDERS, "country": "IN"})
        self.facts(rp['website'], brand='razorpay payments for businesses in india ' * 2)
        multi.build({'yc-india': [rp], 'antler': [blr, nocity, us, parked, nodesc, other]}, None)
        out = multi.load(os.path.join(multi.OUT, 'companies_multi.json'))
        rows = {r['name']: r for r in out['rows']}
        self.assertEqual(set(rows), {'Paytrail', 'Lendkart', 'Acme'})
        self.assertEqual((rows['Paytrail']['country'], rows['Paytrail']['location']), ('India', 'Bengaluru'))
        self.assertEqual((rows['Lendkart']['country'], rows['Lendkart']['location']), ('India', ''))
        self.assertEqual((rows['Acme']['country'], rows['Acme']['location']), ('United States', 'Austin, TX'))
        self.assertNotIn('US check', rows['Paytrail']['notes'])
        self.assertFalse(any(r.get('source') == 'Y Combinator' for r in out['rows']))
        self.assertNotIn('yc-india', out['summary']['per_source'])
        # Criterion 7: no person carries an email.
        for r in out['rows']:
            for p in r.get('people') or []: self.assertNotIn('email', p)
        self.assertEqual(rows['Paytrail']['people'][0]['linkedin_url'], 'https://www.linkedin.com/in/asharao')
        stats = out['summary']['per_source']['antler']
        self.assertEqual(stats['new'], 3)
        self.assertEqual(stats['site_parked'], 1)
        self.assertEqual(stats['no_description'], 1)
        self.assertEqual(stats['not_us'], 1)
        self.assertEqual(stats['coverage_of_new']['city'], 2)
        self.assertEqual(stats['coverage_of_new']['leaders'], 2)


# ---------------------------------------------------------------- founder task #6
# Fixtures are built from the research.md samples (Elevation /portfolio/acko, Stellaris /portfolio/atlas, Prime Finagg and KredX).
import email.message, time, urllib.error  # noqa: E402
from unittest import mock  # noqa: E402

ACKO_CARD = ('<a href="/portfolio/acko"><img src="https://cdn.sanity.io/acko.png" width="80" height="40" alt="">'
             '<p>Acko</p><p>Seed</p><p>Fintech &amp; Financial Services</p><p>Helping millions seamlessly buy insurance</p>'
             '<p>Investing Stage</p><p>Seed</p><p>Founders</p><p>Varun Dua</p></a>')
ELEVATION_LISTING = ('<html><body><nav><a href="/">Home</a><a href="/team">Team</a><a href="/insights">Insights</a>'
                     '<a href="/portfolio">Portfolio</a></nav>' + ACKO_CARD +
                     '<a href="/"><img src="https://cdn.sanity.io/im.png" alt="">Indiamart</a>'
                     '<a href="/plazza"><img src="https://cdn.sanity.io/pl.png" alt=""><p>Plazza</p></a>'
                     '<a href="/portfolio/zeni"><img src="https://cdn.sanity.io/z.png" alt=""><p>Zeni</p><p>Growth</p></a>'
                     '<a href="/privacy-and-terms">Privacy</a></body></html>')
ACKO_DETAIL = ('<html><head><title>Acko | Elevation Capital</title></head><body><nav><a href="/portfolio">Portfolio</a></nav>'
               '<h1>Acko</h1><p>Helping millions seamlessly buy insurance</p><p>Investing Stage</p><p>Seed</p>'
               '<a href="https://www.acko.com/" target="_blank"><span>Visit Acko website</span></a>'
               '<h3>Founders</h3><div class="person"><p>Varun Dua</p>'
               '<a href="https://www.linkedin.com/in/thevarundua/?originalSubdomain=in"><svg></svg></a></div>'
               '<h3>Elevation Team</h3><div class="person"><p>Mridul Arora</p><p>Partner</p>'
               '<a href="https://www.linkedin.com/in/aroramridul/"><svg></svg></a></div>'
               '<footer><a href="https://www.linkedin.com/company/elevation-capital">LinkedIn</a>'
               '<p>Elevation office, Indiranagar, Bengaluru 560038</p></footer></body></html>')
STELLARIS_LISTING = ('<div role="list"><div role="listitem" class="w-dyn-item"><a href="/portfolio/atlas"><h3>Atlas</h3><div>Active</div>'
                     '<p>Powering accounting firms of the future</p><p>THEME</p><p>Software, AI</p><p>ENTRY STAGE</p><p>Idea</p></a></div>'
                     '<div role="listitem" class="w-dyn-item"><a href="/portfolio/oldco"><h3>OldCo</h3><div>Inactive</div></a></div></div>')
STELLARIS_SITEMAP = ('<urlset><url><loc>https://www.stellarisvp.com/portfolio/atlas</loc></url>'
                     '<url><loc>https://www.stellarisvp.com/portfolio/oldco</loc></url><url><loc>https://www.stellarisvp.com/team</loc></url></urlset>')
ATLAS_DETAIL = ('<html><body><h1>Atlas</h1><div>Active</div><a href="https://theatlas.ai/">Website</a>'
                '<a href="https://www.linkedin.com/company/theatlas">LinkedIn</a>'
                '<h4>Founder</h4><div><p>Arpit Maheshwari</p><a href="https://www.linkedin.com/in/arpit-maheshwari/">in</a></div>'
                '<div><p>Jagmal Singh</p><a href="https://www.linkedin.com/in/jagmal/"></a></div>'
                '<p>Partnered</p><p>2025</p><p>Co-investors</p><a href="https://www.accel.com/">Accel</a>'
                '<h4>Stellaris Team</h4><p>Alok Goyal</p><a href="https://www.linkedin.com/in/alokgoyal/"></a>'
                '<div>Consent: write to <a href="mailto:alok@stellarisvp.com">alok@stellarisvp.com</a> or hello@stellarisvp.com</div>'
                '<footer><a href="https://www.linkedin.com/company/stellaris-venture-partners">LinkedIn</a></footer></body></html>')


def prime_page():
    rows = [{"name": "Finagg", "website": "https://finagg.in/", "founders": "Nipun Kohli, Srinivasan R",
             "description": "Finagg Forward Supply Chain financing solution"},
            {"name": "KredX", "website": "https://www.kredx.com/", "founders": ["Manish Kumar", "Anurag Jain"],
             "description": "KredX is an invoice discounting marketplace"},
            {"name": "LinkedIn", "url": "https://www.linkedin.com/company/prime-venture-partners"},
            {"name": "Prime", "url": "https://www.primevp.in/team"}]
    line = '5:' + json.dumps(["$", "div", None, {"companies": rows}]) + '\n'
    return '<html><body><script>self.__next_f.push([1,' + json.dumps(line) + '])</script></body></html>'


def http_error(url, code, retry=None):
    h = email.message.Message()
    if retry is not None: h['Retry-After'] = retry
    return urllib.error.HTTPError(url, code, 'error', h, None)


class TempCache(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        self.saved = (multi.CACHE, multi.OUT, multi.FACTS, multi.SRC, multi._catalog)
        multi.CACHE, multi.OUT, multi.FACTS, multi.SRC = (os.path.join(t, 'cache'), os.path.join(t, 'out'), os.path.join(t, 'facts'),
                                                          os.path.join(t, 'cache', 'sources'))
        multi._catalog = ({}, set())
        multi._detail_blocks.clear()
        self.sleep = mock.patch.object(multi.time, 'sleep').start()
        if hasattr(multi.canon_location, 'v'): del multi.canon_location.v

    def tearDown(self):
        mock.patch.stopall()
        multi.CACHE, multi.OUT, multi.FACTS, multi.SRC, multi._catalog = self.saved
        multi._detail_blocks.clear()
        if hasattr(multi.canon_location, 'v'): del multi.canon_location.v
        self.tmp.cleanup()

    def serve(self, pages):
        """Stub scrape.fetch with a url -> text map; every requested url is recorded in self.asked."""
        self.asked = []

        def fake(url, *a, **kw):
            self.asked.append(url)
            if url not in pages: raise http_error(url, 404)
            v = pages[url]
            if isinstance(v, Exception): raise v
            return url, v
        mock.patch.object(multi.scrape, 'fetch', side_effect=fake).start()


class IndiaEvidence(unittest.TestCase):
    def test_schema_org(self):
        r = multi.india_evidence([('https://x.in/', '{"addressCountry":"IN","addressLocality":"Bangalore"}')], 'x.in')
        self.assertEqual((r['india'], r['city']), (True, 'Bengaluru'))
        r = multi.india_evidence([('https://x.com/', '{"address":{"addressCountry":{"@type":"Country","name":"India"},'
                                                     '"addressLocality":"Gurgaon"}}')], 'x.com')
        self.assertEqual((r['india'], r['city']), (True, 'Gurugram'))
        r = multi.india_evidence([('https://x.com/', '{"addressCountry":"US","addressLocality":"Austin"}')], 'x.com')
        self.assertIsNone(r['india'])

    def test_city_and_pin(self):
        r = multi.india_evidence([('https://x.com/contact', '<p>3rd Floor, 80 Feet Road</p><p>Koramangala, Bengaluru, Karnataka 560034</p>')], 'x.com')
        self.assertEqual((r['india'], r['city']), (True, 'Bengaluru'))
        self.assertIn('/contact', r['why'])
        # a city alone is not evidence, and a phone number is not a PIN
        self.assertIsNone(multi.india_evidence([('https://x.com/', '<p>Teams in Bengaluru and London</p>')], 'x.com')['india'])
        self.assertIsNone(multi.india_evidence([('https://x.com/', '<p>Mumbai office: +91 9820012345</p>')], 'x.com')['india'])
        r = multi.india_evidence([('https://x.com/', '<p>Bombay House, Fort, Bombay 400001</p>')], 'x.com')
        self.assertEqual(r['city'], 'Mumbai')
        self.assertEqual(multi.india_evidence([('https://x.com/', '<p>Connaught Place, Delhi 110001</p>')], 'x.com')['city'], 'New Delhi')

    def test_private_limited(self):
        page = '<footer>© 2025 Acme Technologies Pvt. Ltd. All rights reserved.</footer>'
        self.assertIsNone(multi.india_evidence([('https://acme.com/', page)], 'acme.com')['india'])     # .com, no city: nothing
        r = multi.india_evidence([('https://acme.co.in/', page)], 'acme.co.in')
        self.assertEqual((r['india'], r['city']), (True, ''))
        r = multi.india_evidence([('https://acme.com/', page + '<p>Made in Pune</p>')], 'acme.com')
        self.assertEqual((r['india'], r['city']), (True, 'Pune'))
        self.assertIsNone(multi.india_evidence([('https://acme.in/', '<p>Acme</p>')], 'acme.in')['india'])   # a domain alone: nothing

    def test_no_contact_data_kept(self):
        r = multi.india_evidence([('https://x.com/', '<p>Koramangala, Bengaluru 560034. Call +91 98450 12345, hello@x.com</p>')], 'x.com')
        self.assertTrue(r['india'])
        self.assertNotIn('98450', json.dumps(r))
        self.assertNotIn('@', json.dumps(r))


class Parsers(unittest.TestCase):
    def test_elevation_detail(self):
        d = multi.parse_elevation_detail(ACKO_DETAIL)
        self.assertEqual(d['website'], 'https://www.acko.com/')
        self.assertEqual(d['name'], 'Acko')
        self.assertEqual(len(d['people']), 1)
        p = d['people'][0]
        self.assertEqual((p['first_name'], p['last_name'], p['linkedin_url']), ('Varun', 'Dua', 'https://www.linkedin.com/in/thevarundua/'))
        self.assertNotIn('Mridul', json.dumps(d))
        self.assertNotIn('aroramridul', json.dumps(d))

    def test_elevation_no_team_heading_takes_nobody(self):
        d = multi.parse_elevation_detail(ACKO_DETAIL.replace('Elevation Team', 'People'))
        self.assertEqual(d['people'], [])

    def test_elevation_cards(self):
        paths = [p for p, _ in multi.elevation_cards(ELEVATION_LISTING)]
        self.assertEqual(paths, ['/portfolio/acko', '/plazza', '/portfolio/zeni'])   # '/', nav and legal links are skipped
        self.assertEqual(multi.sector_after_stage(multi.segments(ACKO_CARD)), 'Fintech & Financial Services')

    def test_stellaris_detail_has_no_email(self):
        d = multi.parse_stellaris_detail(ATLAS_DETAIL)
        self.assertEqual(d['website'], 'https://theatlas.ai/')
        self.assertEqual([p['linkedin_url'] for p in d['people']], ['https://www.linkedin.com/in/arpit-maheshwari/', 'https://www.linkedin.com/in/jagmal/'])
        self.assertEqual([p['first_name'] for p in d['people']], ['Arpit', 'Jagmal'])
        self.assertEqual((d['year'], d['status'], d['linkedin_url']), (2025, 'Active', 'https://www.linkedin.com/company/theatlas'))
        blob = json.dumps(d)
        self.assertNotIn('@', blob)
        self.assertNotIn('mailto', blob)
        self.assertNotIn('Alok', blob)

    def test_stellaris_listing(self):
        self.assertEqual(multi.stellaris_listing(STELLARIS_LISTING), {'atlas': ('Active', 'Software, AI'), 'oldco': ('Inactive', '')})

    def test_prime_payload(self):
        got = multi.prime_companies(prime_page())
        self.assertEqual([(n, s) for n, s, _ in got], [('Finagg', 'https://finagg.in/'), ('KredX', 'https://www.kredx.com/')])
        people = multi.people_from_names(got[0][2])
        self.assertEqual([(p['first_name'], p['last_name']) for p in people], [('Nipun', 'Kohli'), ('Srinivasan', 'R')])
        self.assertEqual(len(multi.people_from_names(got[1][2])), 2)

    def test_prime_html_fallback(self):
        page = ('<div><h3>Finagg</h3><p>Founders: Nipun Kohli, Srinivasan R</p><a href="https://finagg.in/">Visit</a></div>'
                '<div><h3>KredX</h3><p>Founders</p><p>Manish Kumar &amp; Anurag Jain</p><a href="https://www.kredx.com/">Visit</a>'
                '<a href="https://www.linkedin.com/company/kredx">in</a></div><h3>Contact</h3><a href="mailto:x@primevp.in">mail</a>')
        got = multi.prime_companies(multi.no_emails(page))
        self.assertEqual([(n, s, f) for n, s, f in got], [('Finagg', 'https://finagg.in/', ['Nipun Kohli', 'Srinivasan R']),
                                                          ('KredX', 'https://www.kredx.com/', ['Manish Kumar', 'Anurag Jain'])])

    def test_honest_user_agent(self):
        self.assertTrue(multi.scrape.UA.startswith('FoundReachBot/1.0 (+https://'))
        self.assertNotIn('Mozilla', multi.scrape.UA)
        with open(os.path.join(ROOT, 'scraper', 'multi.py'), encoding='utf-8') as f: src = f.read().lower()
        self.assertNotIn('proxyhandler', src)
        self.assertNotRegex(src, r'proxies\s*=|set_proxy|https?_proxy')

    def test_sources_registered(self):
        for s in ('elevation', 'stellaris', 'prime'):
            self.assertIn(s, multi.COLLECTORS)
            self.assertIn(s, multi.SOURCE_ORDER)
            self.assertIn('robots.txt', multi.SOURCES[s]['policy'])
        for s in ('kae-capital', 'z47'):
            self.assertNotIn(s, multi.COLLECTORS)
            self.assertIn(s, multi.SKIPPED)


class Fetching(TempCache):
    def test_429_retry_after_then_retry_once(self):
        url = 'https://example.org/p'
        self.serve({url: http_error(url, 429, '1')})
        with self.assertRaises(multi.Blocked) as cm:
            multi.cached_text(os.path.join(multi.SRC, 'x', 'p.html'), url, refresh=True)
        self.assertEqual((cm.exception.status, cm.exception.url), (429, url))
        self.assertEqual(self.asked, [url, url])          # one retry, no more
        self.sleep.assert_any_call(1)

    def test_429_then_ok(self):
        url = 'https://example.org/p'
        answers = [http_error(url, 503), (url, '<html>fine</html>')]

        def fake(u, *a, **kw):
            v = answers.pop(0)
            if isinstance(v, Exception): raise v
            return v
        mock.patch.object(multi.scrape, 'fetch', side_effect=fake).start()
        self.assertEqual(multi.cached_text(os.path.join(multi.SRC, 'x', 'p.html'), url, refresh=True), '<html>fine</html>')
        self.sleep.assert_any_call(30)                    # no Retry-After header: 30 s
        self.assertEqual(multi.retry_after('9999'), 300)
        self.assertEqual(multi.retry_after('soon'), 30)

    def test_challenge_403_timeout(self):
        url = 'https://example.org/p'
        self.serve({url: '<html><head><title>Just a moment...</title></head><body></body></html>'})
        with self.assertRaises(multi.Blocked) as cm: multi.cached_text(os.path.join(multi.SRC, 'x', 'a.html'), url, refresh=True)
        self.assertEqual(cm.exception.status, 'challenge')
        self.assertFalse(os.path.exists(os.path.join(multi.SRC, 'x', 'a.html')))   # a challenge page is never cached
        self.serve({url: http_error(url, 403)})
        with self.assertRaises(multi.Blocked) as cm: multi.cached_text(os.path.join(multi.SRC, 'x', 'b.html'), url, refresh=True)
        self.assertEqual(cm.exception.status, 403)
        self.serve({url: urllib.error.URLError(TimeoutError('timed out'))})
        with self.assertRaises(multi.Blocked) as cm: multi.cached_text(os.path.join(multi.SRC, 'x', 'c.html'), url, refresh=True)
        self.assertEqual(cm.exception.status, 'timeout')
        # a long normal page that loads a captcha widget for its form is not a challenge; JSON never is
        self.assertFalse(multi.is_challenge('<html><body>' + '<p>We build software for clinics.</p>' * 200 + '<script src="recaptcha"></script></body></html>'))
        self.assertFalse(multi.is_challenge('{"hits": [{"title": "captcha"}]}'))

    def test_login_redirect_is_blocked(self):
        url = 'https://x.com/portfolio'
        mock.patch.object(multi.scrape, 'fetch', return_value=('https://x.com/login?next=/portfolio', '<html>Sign in</html>')).start()
        with self.assertRaises(multi.Blocked) as cm: multi.fetch_checked(url)
        self.assertEqual((cm.exception.status, cm.exception.url), ('login', url))
        with self.assertRaises(multi.Blocked):
            multi.cached_text(os.path.join(multi.SRC, 'x', 'l.html'), url, refresh=True)
        self.assertFalse(os.path.exists(os.path.join(multi.SRC, 'x', 'l.html')))       # a sign-in page is never cached
        for final in ('https://x.com/users/sign_in', 'https://x.com/Sign-In', 'https://x.com/auth/signin'):
            mock.patch.object(multi.scrape, 'fetch', return_value=(final, '<html></html>')).start()
            with self.assertRaises(multi.Blocked, msg=final): multi.fetch_checked(url)
        # the same URL, a trailing slash, or a redirect to a normal page returns the text
        for final in (url, url + '/', 'https://www.x.com/portfolio', 'https://x.com/companies', 'https://x.com/blog/login-tips-for-founders'):
            mock.patch.object(multi.scrape, 'fetch', return_value=(final, '<html>ok</html>')).start()
            self.assertEqual(multi.fetch_checked(url), '<html>ok</html>', final)
        # a page that is itself a login path is not a redirect
        mock.patch.object(multi.scrape, 'fetch', return_value=('https://x.com/login', '<html>ok</html>')).start()
        self.assertEqual(multi.fetch_checked('https://x.com/login'), '<html>ok</html>')

    def test_collect_records_blocked_and_empty(self):
        def blocked(refresh): raise multi.Blocked(403, 'https://blocked.example/portfolio')
        def fine(refresh): return [{'name': 'A'}]
        def empty(refresh): return []
        def broken(refresh): raise ValueError('bad json')
        multi.save(os.path.join(multi.CACHE, 'multi_candidates.json'), {'b1': [{'name': 'old'}], 'e1': [{'name': 'old'}]})
        with mock.patch.object(multi, 'COLLECTORS', {'b1': blocked, 'ok1': fine, 'e1': empty, 'f1': broken}):
            allc = multi.collect(None)
        st = multi.load(os.path.join(multi.CACHE, 'source_status.json'))
        self.assertEqual((st['b1']['state'], st['b1']['status'], st['b1']['url']), ('blocked', 403, 'https://blocked.example/portfolio'))
        self.assertEqual((st['ok1']['state'], st['ok1']['listed']), ('ok', 1))
        self.assertEqual(st['e1']['state'], 'empty')
        self.assertEqual(st['f1']['state'], 'failed')
        self.assertEqual(allc['ok1'], [{'name': 'A'}])
        self.assertEqual(allc['b1'], [{'name': 'old'}])   # earlier rows are kept, not replaced by nothing
        self.assertEqual(allc['e1'], [{'name': 'old'}])

    def test_detail_cache_age_and_cap(self):
        dp = multi.DetailPages('elevation', cap=2)
        fresh, old = dp.path('/portfolio/fresh'), dp.path('/portfolio/old')
        for p in (fresh, old):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w') as f: f.write('cached')
        now = time.time()
        os.utime(fresh, (now - 5 * 86400, now - 5 * 86400))
        os.utime(old, (now - 31 * 86400, now - 31 * 86400))
        pages = {'https://e.example/fresh': 'new', 'https://e.example/old': 'new', 'https://e.example/a': 'A', 'https://e.example/b': 'B'}
        self.serve(pages)
        self.assertEqual(dp.get('/portfolio/fresh', 'https://e.example/fresh'), 'cached')   # 5 days old: not fetched, even on --refresh
        self.assertEqual(dp.get('/portfolio/old', 'https://e.example/old'), 'new')          # 31 days old: fetched again
        self.assertEqual(dp.get('a', 'https://e.example/a'), 'A')
        self.assertIsNone(dp.get('b', 'https://e.example/b'))                               # over the cap: next night
        self.assertEqual(self.asked, ['https://e.example/old', 'https://e.example/a'])
        self.assertEqual((dp.fetched, dp.waiting), (2, 1))
        self.assertGreaterEqual(min(c.args[0] for c in self.sleep.call_args_list), 2.0)      # the pause is at least 2 s

    def test_detail_block_stops_the_source(self):
        dp = multi.DetailPages('stellaris')
        self.serve({'https://s.example/a': http_error('https://s.example/a', 403), 'https://s.example/b': 'B'})
        self.assertIsNone(dp.get('a', 'https://s.example/a'))
        self.assertIsNone(dp.get('b', 'https://s.example/b'))
        self.assertEqual(self.asked, ['https://s.example/a'])
        self.assertEqual(multi._detail_blocks['stellaris'].status, 403)

    def timeout_then(self, answers):
        """Stub scrape.fetch with a list of answers in order: 'T' is a time-out, an int is an HTTP error, a str is the page."""
        self.asked = []

        def fake(url, *a, **kw):
            self.asked.append(url)
            v = answers.pop(0)
            if v == 'T': raise urllib.error.URLError(TimeoutError('timed out'))
            if isinstance(v, int): raise http_error(url, v)
            return url, v
        mock.patch.object(multi.scrape, 'fetch', side_effect=fake).start()

    def test_detail_timeouts_reset_on_success(self):
        dp = multi.DetailPages('elevation')
        self.timeout_then(['T', 'T', 'ok', 'T', 'ok'])
        got = [dp.get(k, 'https://e.example/' + k) for k in 'abcde']
        self.assertEqual(got, [None, None, 'ok', None, 'ok'])
        self.assertEqual(len(self.asked), 5)
        self.assertIsNone(dp.blocked)
        self.assertNotIn('elevation', multi._detail_blocks)

    def test_detail_three_timeouts_in_a_row_stop(self):
        dp = multi.DetailPages('elevation')
        self.timeout_then(['T', 'T', 'T', 'never'])
        for k in 'abc': self.assertIsNone(dp.get(k, 'https://e.example/' + k))
        self.assertEqual(dp.blocked.status, 'timeout')
        self.assertEqual(multi._detail_blocks['elevation'].status, 'timeout')
        self.assertIsNone(dp.get('d', 'https://e.example/d'))
        self.assertEqual(len(self.asked), 3)                                              # the 4th call makes no fetch

    def test_detail_refusal_stops_at_once(self):
        for code in (403, 429, 503):
            multi._detail_blocks.clear()
            dp = multi.DetailPages('prime')
            self.timeout_then([code, code, 'never'])                                      # 429/503 are retried once by fetch_checked
            self.assertIsNone(dp.get('a', 'https://p.example/a'))
            self.assertEqual(dp.blocked.status, code)
            self.assertIsNone(dp.get('b', 'https://p.example/b'))
            self.assertEqual(len(self.asked), 1 if code == 403 else 2, code)
        dp = multi.DetailPages('prime')
        self.timeout_then(['<html><head><title>Just a moment...</title></head></html>', 'never'])
        dp.get('a', 'https://p.example/a')
        self.assertEqual(dp.blocked.status, 'challenge')
        self.assertIsNone(dp.get('b', 'https://p.example/b'))
        self.assertEqual(len(self.asked), 1)
        dp = multi.DetailPages('prime')
        mock.patch.object(multi.scrape, 'fetch', return_value=('https://p.example/login', '<html></html>')).start()
        dp.get('a', 'https://p.example/a')
        self.assertEqual(dp.blocked.status, 'login')

    def test_collect_elevation_end_to_end(self):
        base = 'https://elevationcapital.com'
        self.serve({base + '/portfolio': ELEVATION_LISTING, base + '/portfolio/acko': ACKO_DETAIL})
        rows = multi.collect_elevation(True)
        self.assertNotIn(base + '/', self.asked)
        acko = next(r for r in rows if r['name'] == 'Acko')
        self.assertEqual((acko['website'], acko['country'], acko['description'], acko['sector'], acko['industry']),
                         ('https://www.acko.com/', '', '', 'Fintech & Financial Services', 'Fintech'))
        self.assertEqual(acko['source_url'], base + '/portfolio/acko')
        self.assertEqual(len(acko['people']), 1)
        self.assertEqual({r['name'] for r in rows}, {'Acko', 'Plazza', 'Zeni'})   # detail 404: listing name, no website

    def test_collect_stellaris_active_only(self):
        self.serve({'https://www.stellarisvp.com/portfolio': STELLARIS_LISTING, 'https://www.stellarisvp.com/sitemap.xml': STELLARIS_SITEMAP,
                    'https://www.stellarisvp.com/portfolio/atlas': ATLAS_DETAIL})
        rows = multi.collect_stellaris(True)
        self.assertEqual([r['name'] for r in rows], ['Atlas'])
        self.assertNotIn('https://www.stellarisvp.com/portfolio/oldco', self.asked)   # Inactive: no row, no request
        self.assertEqual((rows[0]['website'], rows[0]['sector'], rows[0]['badge']), ('https://theatlas.ai/', 'Software', 'Stellaris Venture Partners 2025'))
        self.assertNotIn('@', json.dumps(rows))

    def test_collect_prime(self):
        self.serve({'https://www.primevp.in/portfolio': prime_page()})
        rows = multi.collect_prime(True)
        self.assertEqual([(r['name'], r['country'], r['description']) for r in rows], [('Finagg', '', ''), ('KredX', '', '')])
        self.assertEqual(len(rows[1]['people']), 2)


class IndiaFromSite(TempCache):
    def facts(self, website, **kw):
        f = {'ok': True, 'parked': False, 'us': None, 'why': '', 'city': '', 'description': 'Insurance you can buy online in minutes.',
             'brand': 'acko insurance you can buy online ' * 2, 'names': [], 'final_host': '', **kw}
        multi.save(os.path.join(multi.FACTS, multi.site_key(website) + '.json'), f)

    def elevation(self, name='Acko', website='https://www.acko.com/'):
        return multi.india_candidate('elevation', name, website, 'Fintech & Financial Services', 'https://elevationcapital.com/portfolio/acko',
                                     [{'first_name': 'Varun', 'last_name': 'Dua', 'role': 'Founder', 'role_category': 'Primary',
                                       'linkedin_url': 'https://www.linkedin.com/in/thevarundua/'}])

    def build_one(self):
        multi.build({'elevation': [self.elevation()]}, None)
        out = multi.load(os.path.join(multi.OUT, 'companies_multi.json'))
        return out, {r['name']: r for r in out['rows']}

    def test_site_says_india(self):
        self.facts('https://www.acko.com/', india=True, india_city='Mumbai', us=False, why='country domain .in', india_why='schema.org addressCountry IN')
        out, rows = self.build_one()
        self.assertEqual((rows['Acko']['country'], rows['Acko']['location']), ('India', 'Mumbai'))
        self.assertIn('India check', rows['Acko']['notes'])
        self.assertEqual(out['summary']['per_source']['elevation']['india_from_site'], 1)
        self.assertEqual(rows['Acko']['people'][0]['linkedin_url'], 'https://www.linkedin.com/in/thevarundua/')

    def test_us_evidence_wins(self):
        self.facts('https://www.acko.com/', india=True, india_city='Mumbai', us=True, city='Austin, TX', why='US address')
        _, rows = self.build_one()
        self.assertEqual(rows['Acko']['country'], 'United States')

    def test_no_evidence_is_dropped(self):
        self.facts('https://www.acko.com/', india=None, us=None)
        out, rows = self.build_one()
        self.assertEqual(rows, {})
        self.assertEqual(out['summary']['per_source']['elevation']['location_unknown'], 1)

    def test_indian_row_city_from_site(self):
        c = BuildGate.antler(None, 'Lendkart', 'https://lendkart.example', 'IN', '', 'Loans for small businesses in India.')
        self.facts(c['website'], brand='lendkart loans for small businesses ' * 2, india=True, india_city='Ahmedabad')
        multi.build({'antler': [c]}, None)
        rows = multi.load(os.path.join(multi.OUT, 'companies_multi.json'))['rows']
        self.assertEqual((rows[0]['country'], rows[0]['location']), ('India', 'Ahmedabad'))

    def test_summary_carries_source_status(self):
        multi.save(os.path.join(multi.CACHE, 'source_status.json'), {'prime': {'state': 'blocked', 'status': 429}})
        self.facts('https://www.acko.com/', india=True, us=False)
        out, _ = self.build_one()
        self.assertEqual(out['summary']['source_status']['prime']['state'], 'blocked')

    def test_to_enrich_asks_for_india(self):
        jobs = multi.to_enrich({'elevation': [self.elevation()], 'antler': [BuildGate.antler(None, 'L', 'https://l.example', 'IN')],
                                'a16z': [{**self.elevation('X', 'https://x.example'), 'source': 'a16z'}]}, None, {})
        flags = {j[1]: (j[2], j[3]) for j in jobs}
        self.assertEqual(flags['https://www.acko.com/'], (True, True))
        self.assertEqual(flags['https://l.example'], (False, True))
        self.assertEqual(flags['https://x.example'], (True, False))

    def test_to_enrich_skips_switched_off_sources(self):
        # B-043: yc-india candidates left in the cache from before YC was switched off are never visited.
        rp = multi.yc_candidate(RAZORPAY, {"founders": FOUNDERS, "country": "IN"})
        self.assertEqual(multi.to_enrich({'yc-india': [rp]}, None, {}), [])
        self.assertEqual(len(multi.to_enrich({'antler': [{**rp, 'source': 'antler'}]}, None, {})), 1)


if __name__ == '__main__':
    unittest.main()
