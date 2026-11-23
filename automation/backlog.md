# FoundReach backlog

Maintained by the daily run (the plan stage edits this file; see `automation/prompts/plan.md`).
Highest priority first. One feature is taken per day, sized to finish in one run.

Format of an item:

```
### B-000 Title
- Why: one or two lines, with evidence when there is any
- Size: S | M | L (L must be split into slices before it is picked)
- Status: open | in progress (date) | done (date, PR) | dropped (reason) | superseded by B-000
- Notes: slices, decisions needed, links
```

Never delete an item. Finished items move to "Done" at the bottom as one line each.

---

## Open

### B-023 India slice 1: YC + Antler India, country ingest, browse by country (founder task #2)
- Why: founder task #2; YC and Antler are cleared (research 2026-11-23); India rows are dropped today
  (`multi.py:704,748`) and would be stored as US (`202611240001_multi_source.sql:240`)
- Size: M, migration `202611260001_country_ingest.sql`
- Status: in progress (2026-11-23), run 2: fix the city lost in `build()` (CTO problem 1) and turn yc-india off
- Notes: live India count = the total on `/companies?country=india`; report it every run. Run 2 decision:
  YC terms forbid scraping (research 2026-11-23, run 2), so slice 1 ships with Antler India only

### B-031 Pause YC page fetching in the US pipeline unless the founder clears YC (founder task #2)
- Why: YC Terms of Use forbid "data mining, robots, scraping" (https://www.ycombinator.com/legal). `api/cron/refresh.js:36`
  and `scraper/scrape.py:77-95` fetch `ycombinator.com/companies/<slug>`. Asked in requests.md 2026-11-23
- Size: S, no migration. Existing US rows stay live; only new fetches stop. Skip if the founder sends permission first
- Status: open

### B-032 City for Antler India rows from the company's own site (founder task #2)
- Why: Antler gives only a country (`multi.py:338`), and its detail pages are disallowed, so Antler India rows have no city.
  Use schema.org `addressLocality` only when `addressCountry` is India, next to `us_evidence()` (`multi.py:620-630`)
- Size: S–M, no migration
- Status: open

### B-033 Fix the "United States" entry in the city list
- Why: `/companies` City filter lists "United States (1)" (research 2026-11-23, run 2); it will mix with Indian cities
- Size: S, an update-only migration like B-028
- Status: open

### B-024 India slice 2: Elevation and Stellaris collectors, Accel India (founder task #2)
- Why: both list founders with `/in/` LinkedIn; terms have no clause (research 2026-11-23). Accel has no
  location: India only from the company's own site (schema.org addressCountry, `.in`), never from Accel's fund
- Size: M, no migration
- Status: open
- Notes: Stellaris detail pages hold Stellaris staff emails in consent text: never parse them

### B-025 India slice 3: daily cron and ingest_companies accept India (founder task #2)
- Why: `api/cron/refresh.js:42` and `api/_lib/yc.js:19` drop non-US; `ingest_companies` inserts 'United States'
- Size: S–M, migration
- Status: open

### B-026 India slice 4: re-check Blume and Prime terms (founder task #2)
- Why: Blume has the best location data; both held because terms were not read (Blume homepage 403)
- Size: S–M
- Status: open

### B-027 India slice 5: country facets, India in navigation and sitemap, country-aware cities (founder task #2)
- Why: visitors should see India from the nav and home page; Indian cities must not merge with US ones
- Size: M, migration (facet counts)
- Status: open
- Notes: add an expression index on `fr_slugify(country)` for `catalog_list_country` (CTO note 2026-11-23)

### B-028 Correct country and location of existing rows a source states as Indian (founder task #2)
- Why: a YC/Antler India company already in the catalog (matched on domain) keeps 'United States'; `ingest_catalog`
  never overwrites a stored field (`coalesce`), so a wrong first city is permanent too (CTO note 2026-11-23)
- Size: S, migration (update on match only when the source states the country or city)
- Status: open

### B-001 Go global: countries in the catalog, the pages and the collectors
- Why: the product direction is a directory for all countries. Today everything is US-only, so most
  of the world's companies and most visitors are left out.
- Size: L, to be delivered in slices (one per day)
- Status: open. Slice 1 done (2026-11-23, PR #1: country shown + US-neutral copy). Slices 2, 3, 5 in
  part via B-023 (country ingest, `country` filter on /companies, India collectors)
- Notes: US-only code: `api/_lib/yc.js` `usCompanies()` and the cron's `not-us` skip; `country =
  'United States'` defaults in the catalog migrations; `us_evidence()`/`need_us` in `scraper/`.
  Slices: 1 country shown (done); 2 country column, filter and facets (migration); 3 `/companies`
  country filter; 4 `/country/:slug` pages, noindex under 10 companies; 5 cron keeps the stated country;
  6 scraper gate "country stated by source or own site"; 7 country-aware city and sector pages.

### B-013 Careers link on /hiring cards and hiring-only facet counts
- Why: job seekers must open each company to reach its careers page; /hiring filter counts look
  like all companies (research 2026-11-23; https://hn.algolia.com/api/v1/items/44986911)
- Size: S
- Status: open

### B-014 Clean up the city facet
- Why: duplicates ("New York City, NY" / "New York, New York"), state-only entries, "United States"
  and "Remote, OR" in the city list; groundwork for B-001 slices 4 and 7 and for local founder meetups
  (https://hn.algolia.com/api/v1/items/44902569)
- Size: S–M (display-time normalisation map first; stored normalisation later)
- Status: open

### B-015 Source URL per company on its page
- Why: "Sources" names Y Combinator but links nothing; accuracy worries
  (https://hn.algolia.com/api/v1/items/49974089); guardrails already require source URLs
- Size: S if the URL is stored, M otherwise (check the schema first)
- Status: open

### B-016 Home page leftovers for crawlers
- Why: "Opening your desk…" boot text sits in the static HTML (`index.html:221`); `<noscript>` hides
  it for browsers but crawlers still read it
- Size: S
- Status: open

### B-017 Remote flag on /hiring, only when the source states it
- Why: Wellfound and Built In both filter by remote; non-US job seekers ask for it
  (https://hn.algolia.com/api/v1/items/49039128)
- Size: M, probably a migration. Part of B-003.
- Status: open

### B-018 Funding stage and recent round, sort by recent funding
- Why: TopStartups shows stage and last round; "new money means urgent hiring"
  (https://hn.algolia.com/api/v1/items/44986911). Only from sources that state it.
- Size: M–L, needs a migration; split before picking
- Status: open

### B-019 Added date per entry and an RSS feed on /new
- Why: returning visitors, investors and sales watch new companies; /new has no dates and no feed
- Size: S
- Status: open

### B-020 Data quality checks: batch labels and sector labels
- Why: "YC S27" shown in Nov 2026 on /companies/memorable; card sectors ("Security", "Marketing")
  are not in the sector filter
- Size: S (investigate, then fix or add a backlog item)
- Status: open

### B-021 "Save" on cards for signed-out visitors
- Why: `/?save=…` lands a signed-out visitor on the home page with no explanation
- Size: S
- Status: open

### B-022 Founder decisions on home-page wording
- Why: the home page promises signed-in "emails", and its "After you sign in" preview shows a named
  founder (sample or real?). If the founder is real, that person is shown off their company page.
- Size: S once decided
- Status: open (needs the founder)

### B-002 Entry points for each audience
- Why: visitors arrive with different goals; one generic directory page serves none of them well.
- Size: M per audience
- Status: open
- Notes: one saved view per audience: job seekers, founders, partnerships/sales, investors.

### B-003 Hiring filters and alerts for job seekers
- Why: "who is hiring" is the most common reason people browse startup lists.
- Size: M
- Status: open
- Notes: start with better filters on `/hiring` (sector, city, country, remote when stated by the
  company). Alerts depend on B-004.

### B-004 Saved searches and alerts
- Why: a reason to come back; turns one visit into a habit.
- Size: L, split
- Status: open
- Notes: save a filter set, later notify new matches; migration; email sending must use no paid service.

### B-005 Weekly digest email
- Why: brings people back with new companies in their sector or country.
- Size: L, split
- Status: open
- Notes: depends on B-004 and the sending service; opt-in, one-click unsubscribe.

### B-006 More sources
- Why: coverage is the product. Each allowed source adds companies and a badge.
- Size: M per source
- Status: open
- Notes: terms check in the plan before code; skipped: `SKIPPED` in `multi.py`; on hold: a16z, 500 Global.

### B-007 Company-page freshness: re-verify what we show
- Why: dead links and closed companies make the whole directory look unreliable.
- Size: M
- Status: open
- Notes: re-check a daily slice (site alive, careers page), show "last checked"; low rate, cached.

### B-008 Tell the admin when a removal request arrives
- Why: removal requests must be honoured quickly; today someone has to look in the database.
- Size: S
- Status: open
- Notes: no personal data in the notification beyond what the request contains; no new service.

### B-009 Update the privacy page for the public directory
- Why: `public/privacy/` predates the public directory and the collection of company data.
- Size: S
- Status: open
- Notes: what is collected, from where, what is never published, how to ask for removal.

### B-010 Sitemap and SEO monitoring
- Why: the directory lives on search traffic; a broken sitemap or a wave of thin pages goes unnoticed.
- Size: S
- Status: open
- Notes: test sitemap validity and size, consistent canonicals, thin pages `noindex`.

### B-011 Performance budget checks
- Why: the guardrails set a budget (HTML under 100 KB, no blocking third-party requests); nothing
  checks it yet.
- Size: S
- Status: open
- Notes: a `node --test` check on rendered pages with fixture data.

### B-012 Test coverage for the directory and the collectors
- Why: the daily run changes this code every day; tests are what make auto-merge safe to turn on.
- Size: M, ongoing
- Status: open
- Notes: start with `render.js` (escaping, no contact data, suppressed slugs) and `yc.js` fixtures.

---

## Done

- B-001 slice 1: show company country, drop US-only copy | done (2026-11-23, PR #1)
- B-029 Peak XV, Kalaari, 3one4, Nexus | dropped (2026-11-23, their terms forbid scraping or reuse)
- B-030 Python collector tests in a gate | done (2026-11-23, pipeline commit de0dd31 runs `python3 -m unittest`)
