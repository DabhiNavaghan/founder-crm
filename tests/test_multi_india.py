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

    def test_pages_per_run(self):
        self.assertEqual(multi.YC_PAGES_PER_RUN, 150)
        self.assertIn("yc-india", multi.COLLECTORS)
        self.assertIn("yc-india", multi.SOURCES)

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

    def test_india_rows_kept_without_us_evidence(self):
        rp = multi.yc_candidate(RAZORPAY, {"founders": FOUNDERS, "country": "IN"})
        rc = multi.yc_candidate(REDCARPET, {"founders": [], "country": "IN"})
        self.facts(rp['website'], brand='razorpay payments for businesses in india ' * 2)
        self.facts(rc['website'], brand='redcarpetup credit cards for indians ' * 2)
        us = {'source': 'antler', 'name': 'Acme', 'website': 'https://acme.example', 'description': 'Payments for small shops in Texas.',
              'sector': '', 'industry': None, 'location': '', 'country': 'US', 'active': True, 'source_url': 'https://www.antler.co/portfolio',
              'badge': 'Antler 2024', 'year': 2024, 'people': [{'first_name': 'Jo', 'last_name': 'Doe', 'role': 'CEO', 'linkedin_url': '', 'email': 'jo@acme.example'}],
              'linkedin_url': ''}
        self.facts(us['website'], brand='acme payments for small shops ' * 2)
        parked = {**rc, 'name': 'Parked', 'website': 'https://parked.example'}
        self.facts(parked['website'], parked=True)
        nodesc = {**rc, 'name': 'Nodesc', 'website': 'https://nodesc.example', 'description': ''}
        self.facts(nodesc['website'], brand='nodesc ' * 10)
        other = {**us, 'name': 'Sing', 'website': 'https://sing.example', 'country': 'other'}
        multi.build({'yc-india': [rp, rc, parked, nodesc], 'antler': [us, other]}, None)
        out = multi.load(os.path.join(multi.OUT, 'companies_multi.json'))
        rows = {r['name']: r for r in out['rows']}
        self.assertEqual(set(rows), {'Razorpay', 'RedCarpetUp', 'Acme'})
        self.assertEqual(rows['Razorpay']['country'], 'India')
        self.assertEqual(rows['Razorpay']['location'], 'Bengaluru')
        self.assertEqual(rows['Razorpay']['source'], 'Y Combinator')
        self.assertEqual(rows['Razorpay']['badges'], [{'label': 'YC W15', 'source': 'yc'}])
        self.assertTrue(rows['Razorpay']['logo_url'].startswith('https://bookface-images'))
        self.assertNotIn('US check', rows['Razorpay']['notes'])
        self.assertEqual(rows['RedCarpetUp']['country'], 'India')
        self.assertEqual(rows['Acme']['country'], 'United States')
        for r in out['rows']:
            for p in r.get('people') or []: self.assertNotIn('email', p)
        stats = out['summary']['per_source']
        self.assertEqual(stats['yc-india']['new'], 2)
        self.assertEqual(stats['yc-india']['site_parked'], 1)
        self.assertEqual(stats['yc-india']['no_description'], 1)
        self.assertEqual(stats['antler']['not_us'], 1)
        self.assertEqual(stats['yc-india']['coverage_of_new']['leaders'], 1)


if __name__ == '__main__':
    unittest.main()
