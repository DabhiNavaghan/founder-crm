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


if __name__ == '__main__':
    unittest.main()
