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

### B-040 Team room slice 1: live agent dashboard at /app/team (founder task #4)
- Why: founder task #4; data already in `agent_dashboard(p_runs)` (`202611270001_agent_events.sql`)
- Size: M
- Status: in progress (2026-11-23)
- Notes: admin-only route and nav, Now, Team cards, Board, run detail, Night shift, 15 s polling. See task-4 plan.md

### B-041 Team room slice 2: Usage panel and retro text (founder task #4)
- Why: task.md items 4 (retro part) and 6 (time, turns, tokens, cost per agent, last run and 7 days)
- Size: S
- Status: open
- Notes: build on B-040's `src/lib/team.js`; null `turns`/`cost_usd` must show "–"; bars need a text value too

### B-042 Re-check Antler terms (founder/legal hygiene)
- Why: CTO review problem 2: no global terms page found; check contact page, footer links, privacy page; switch Antler off like YC if they forbid collection
- Size: S
- Status: open
- Notes: may duplicate an item added on PR #3's branch; merge them when that PR lands

### B-043 `to_enrich()` skips slugs not in COLLECTORS
- Why: CTO review problem 3: stale `yc-india` candidates still cause site fetches (`scraper/multi.py:812-813`)
- Size: S
- Status: open
- Notes: one line `if slug not in COLLECTORS: continue`; wait until PR #3 merges to avoid a conflict

### B-001 Go global: countries in the catalog, the pages and the collectors
- Why: the product direction is a directory for all countries. Today everything is US-only, so most
  of the world's companies and most visitors are left out.
- Size: L, to be delivered in slices (one per day)
- Status: in progress (2026-11-23), slice 1 (country shown + US-neutral copy, with migration
  `202611250001_catalog_country.sql` that only exposes `country` in the catalog JSON)
- Notes: where the US-only assumption lives today:
  - `api/_lib/yc.js`: `usCompanies()` keeps only companies whose YC region includes
    "United States of America"; the daily cron skips non-US pages with reason `not-us`.
  - `supabase/migrations/*`: `country = 'United States'` defaults and filters in the catalog
    functions (see `202611230001_public_directory.sql`, `202611230002_directory_fixes.sql`,
    `202611240001_multi_source.sql`).
  - Copy that says "US startups" in `api/_lib/render.js`, the landing page under `src/landing/`,
    the sitemap and meta descriptions.
  - `scraper/scrape.py` and `scraper/multi.py`: `us_evidence()`, `need_us`, the `not_us` counters.
  Suggested slices, each complete on its own:
  1. Show the country on company cards and company pages where it is already known; change copy
     from "US startups" to wording that stays true as other countries arrive. No migration.
  2. Migration: make `country` a first-class, indexed column with a country slug; catalog functions
     accept an optional country filter and return country facets. Code must work before it is applied.
  3. Country filter in `/companies` (plain GET parameter, works without JavaScript).
  4. Country pages `/country/:slug` with a threshold (for example at least 10 companies) below
     which the page is `noindex` and left out of the sitemap; link them from the directory.
  5. Collectors: stop dropping non-US companies in `api/_lib/yc.js` and the daily cron; keep the
     country the source states; never guess a country.
  6. Scraper: replace the US-evidence gate with "country stated by the source or by the company's
     own site"; keep the row when the country is known, mark it unknown otherwise.
  7. City pages and sector pages: make them country-aware so two cities with the same name do not merge.

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
- Notes: one landing section or page per audience, each a saved view of the same directory:
  job seekers (hiring filter, careers links), founders reaching founders (stage and sector),
  partnerships and sales (sector, size, contact page), investors (batch, source, recency).
  Research should confirm which audience to serve first.

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
- Notes: signed-in users save a filter set; a later slice notifies them of new matches. Needs a
  migration and a decision on how email is sent (no new paid service).

### B-005 Weekly digest email
- Why: brings people back with new companies in their sector or country.
- Size: L, split
- Status: open
- Notes: depends on B-004 and on a founder decision about the sending service. Opt-in only, with
  one-click unsubscribe.

### B-006 More sources
- Why: coverage is the product. Each allowed source adds companies and a badge.
- Size: M per source
- Status: open
- Notes: only sources whose robots.txt and terms allow automated collection. Skipped so far and
  why: see `SKIPPED` in `scraper/multi.py`. On hold pending the founder's decision: a16z,
  500 Global. Candidates need a terms check written into the plan before any code.

### B-007 Company-page freshness: re-verify what we show
- Why: dead links and closed companies make the whole directory look unreliable.
- Size: M
- Status: open
- Notes: a daily slice of the catalog is re-checked (site alive, careers page still there), with a
  "last checked" date on the page. Low request rate, cached.

### B-008 Tell the admin when a removal request arrives
- Why: removal requests must be honoured quickly; today someone has to look in the database.
- Size: S
- Status: open
- Notes: no personal data in the notification beyond what the request contains; no new service.

### B-009 Update the privacy page for the public directory
- Why: `public/privacy/` predates the public directory and the collection of company data.
- Size: S
- Status: open
- Notes: say what is collected, from where, what is never published, and how to ask for removal.
  The founder should read the final wording before it goes live.

### B-010 Sitemap and SEO monitoring
- Why: the directory lives on search traffic; a broken sitemap or a wave of thin pages goes unnoticed.
- Size: S
- Status: open
- Notes: a test that the sitemap is valid and under the size limit, canonical URLs are consistent,
  thin pages are `noindex`.

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
- Notes: start with `api/_lib/render.js` (escaping, no contact data in output, suppressed slugs) and
  `api/_lib/yc.js` (parsing with fixtures). Tests live in `tests/` and run with `npm test`.

---

## Done

(nothing yet)
