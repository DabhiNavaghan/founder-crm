-- FoundReach public directory, round 2 fixes. Run after 202611230001_public_directory.sql.
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor and run it.
--
--   * companies.industry (YC's top-level industry) drives the sector filter and /sector pages;
--   * only real LinkedIn pages (/company/, /in/, /school/, /showcase/) are returned, never search links;
--   * only real contact pages are kept as contact_url;
--   * imported rows no longer count as "new"; /new is capped at 30;
--   * filter options are merged by slug so dropdown counts and page totals always agree.

begin;

alter table public.companies add column if not exists industry text;

-- ---------------------------------------------------------------- link rules
-- A LinkedIn link is public only if it is a company, person, school or showcase page.
create or replace function public.fr_safe_linkedin(u text) returns text
language sql immutable parallel safe as $$
  select case
    when public.fr_safe_url(u) ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/(company|in|school|showcase)/[^/?#]+' then public.fr_safe_url(u)
    else null
  end
$$;

-- A contact page has a path segment that is exactly contact, contact-us, contactus, get-in-touch, support or help.
create or replace function public.fr_contact_url(u text) returns text
language sql immutable parallel safe as $$
  select case
    when public.fr_safe_url(u) ~* '^https?://[^/?#]+(/[^/?#]+)*/(contact|contact-us|contactus|get-in-touch|support|help)(/[^?#]*)?([?#].*)?$' then public.fr_safe_url(u)
    else null
  end
$$;

-- ---------------------------------------------------------------- data fixes
-- Contact links that are not contact pages (catalog rows and the copies users made of them).
update public.companies
   set contact_url = null
 where (is_catalog or catalog_slug is not null)
   and contact_url is not null
   and public.fr_contact_url(contact_url) is null;

-- Rows loaded by import (before the first refresh run) are not "new":
-- no batch -> a fixed old date; a batch dated on/after the import day -> a month before the import.
update public.companies
   set first_seen_at = timestamptz '2020-01-01 00:00:00+00'
 where is_catalog and batch is null
   and created_at < coalesce((select min(ran_at) from public.refresh_runs), now())
   and first_seen_at is distinct from timestamptz '2020-01-01 00:00:00+00';
update public.companies
   set first_seen_at = created_at - interval '30 days'
 where is_catalog and batch is not null
   and created_at < coalesce((select min(ran_at) from public.refresh_runs), now())
   and first_seen_at >= created_at;

-- Industry for YC companies, from the public yc-oss index. Other rows keep industry null.
update public.companies c
   set industry = v.industry
  from (values
  ('0security','B2B'),('10-by-10','B2B'),('10x','Healthcare'),('10x-science','B2B'),('1849-bio','Industrials'),('1910','Healthcare'),
  ('1stcollab','B2B'),('21st','B2B'),('222','Consumer'),('42','B2B'),('64x-bio','Healthcare'),('6thsense','Industrials'),
  ('7cups','Healthcare'),('83-sciences','Industrials'),('9-mothers-corporation','Industrials'),('a0-dev','B2B'),('a1base','B2B'),('abacum','B2B'),
  ('abalone-bio','Healthcare'),('abel-police','Government'),('abinitio-bio','Healthcare'),('absurd','B2B'),('abundant','B2B'),('accord','B2B'),
  ('accountable','Real Estate and Construction'),('acely','Education'),('acolite','Fintech'),('activeloop','B2B'),('activepieces','B2B'),('acunote','B2B'),
  ('acx','Healthcare'),('adam','B2B'),('adapted','Consumer'),('adaptional','B2B'),('aden','B2B'),('adentris','Healthcare'),
  ('adialante','Healthcare'),('adni','Healthcare'),('adri-ai','B2B'),('adsideai','B2B'),('advanced-metal-research','Industrials'),('advano','Industrials'),
  ('adventris-pharmaceuticals','Healthcare'),('adyn','Healthcare'),('aegis','Healthcare'),('aemon','B2B'),('aernata','Industrials'),('aerogen-systems','Industrials'),
  ('aesculatech','Healthcare'),('aesthetic','B2B'),('affil-ai','B2B'),('affinity','B2B'),('affogato-ai','B2B'),('afriex','Fintech'),
  ('aftercare','B2B'),('afternoon-co','B2B'),('afterquery','B2B'),('agape','Healthcare'),('agave','B2B'),('agency','B2B'),
  ('agency-tool-company','Industrials'),('agent-37','B2B'),('agent-relay','B2B'),('agentcard','Fintech'),('agentcollect','Fintech'),('agentic-fabriq','B2B'),
  ('agentic-labs-2','B2B'),('agentin-ai','B2B'),('agentmail','B2B'),('agentphone','B2B'),('ageospatial','Fintech'),('agi-deployment-company','B2B'),
  ('agilemd','Healthcare'),('agnost-ai','B2B'),('ai-2','B2B'),('ai-coach','B2B'),('ai-insurance','Fintech'),('ai-tech-packs','B2B'),
  ('aidy','Healthcare'),('aikido-technologies','Industrials'),('ailit','Industrials'),('aios','Healthcare'),('aiprise','Fintech'),('airbnb','Consumer'),
  ('airbyte','B2B'),('aircaps-ai','B2B'),('airfordable','Fintech'),('airgoods','B2B'),('airhart-aeronautics','Industrials'),('airmyne','Industrials'),
  ('airweave','B2B'),('aisdr','B2B'),('aivideo-com','B2B'),('akido-labs','Healthcare'),('akkari','B2B'),('akon-labs','B2B'),
  ('aktoria-robotics','Industrials'),('akute-health','Healthcare'),('alai','B2B'),('albacore-inc','Industrials'),('albedo','Industrials'),('albiware-inc','Real Estate and Construction'),
  ('alchemize','B2B'),('alder','B2B'),('aleph','B2B'),('aleph-lab','Consumer'),('alex','B2B'),('alex-com','B2B'),
  ('alga-biosciences','Industrials'),('algen-biotechnologies','Healthcare'),('algolia','B2B'),('alinea','Fintech'),('alixia','Healthcare'),('alkali','B2B'),
  ('alkera-ai','B2B'),('allia-health','Healthcare'),('alloovium','Real Estate and Construction'),('allowance','Fintech'),('alloy','B2B'),('allus-ai','Industrials'),
  ('alma','Fintech'),('almanac','B2B'),('almond-2','Industrials'),('alpaca','Fintech'),('alpha-vantage','Fintech'),('alphawatch-ai','Fintech'),
  ('alrighty','Consumer'),('alt-x','Fintech'),('altair-health','Healthcare'),('altay-therapeutics','Healthcare'),('alter','B2B'),('aluna','B2B'),
  ('amberbox-gunshot-detection','B2B'),('ambient-ai','B2B'),('ambition','B2B'),('amboras','B2B'),('ambral','B2B'),('amby-health','Healthcare'),
  ('amera','Fintech'),('amika','B2B'),('amorphic-labs','B2B'),('ample-computer','B2B'),('amplitude','B2B'),('ampup','Consumer'),
  ('anakin','B2B'),('anana','B2B'),('ananya-health','Healthcare'),('anara','B2B'),('anchorhead','B2B'),('andco','B2B'),
  ('andi','Consumer'),('andon-labs','B2B'),('andromeda-surgical','Healthcare'),('andson-biotech','Healthcare'),('andy-ai','Healthcare'),('angle-health','Fintech'),
  ('angstrom-ai','Healthcare'),('anjuna','B2B'),('ankr-health','Healthcare'),('anniecannons','Education'),('anoria','Consumer'),('ansa-biotechnologies','Healthcare'),
  ('answerthis','Consumer'),('anthrogen','Healthcare'),('antigen','B2B'),('antimattr','Consumer'),('antinuous','B2B'),('anto-biosciences','Healthcare'),
  ('antropi-robotics','Industrials'),('anyalpha','Fintech'),('anylist','Consumer'),('anythingllm','Consumer'),('anywhere','Consumer'),('aoa-dx-inc','Healthcare'),
  ('apero-health','Healthcare'),('apolink','Industrials'),('apollo','B2B'),('apollo-atomics-inc','Industrials'),('apollo-io','B2B'),('apoxy','B2B'),
  ('apozy','B2B'),('applied-electrodynamics-inc','Industrials'),('applied-kinetics','Industrials'),('apprentice-health','Healthcare'),('aptdeco','Consumer'),('apten','B2B'),
  ('aqua','Fintech'),('aqua-voice','Consumer'),('aquashield','Real Estate and Construction'),('aqueduct','B2B'),('aragorn-ai','B2B'),('aravolta','B2B'),
  ('arbital','Fintech'),('arc-prize-foundation','Industrials'),('archal','B2B'),('archangel-health','Healthcare'),('archform','Healthcare'),('archgen-labs','Industrials'),
  ('archil','B2B'),('archilabs','Real Estate and Construction'),('archon','Government'),('arcimus','B2B'),('arctic-health','Healthcare'),('arden','B2B'),
  ('ardent','B2B'),('aren','Healthcare'),('ares-industries','Industrials'),('arga-labs','B2B'),('argo','Consumer'),('argon-ai-inc','Healthcare'),
  ('args','B2B'),('argument-computer-corporation','B2B'),('arini','Healthcare'),('arintra','Healthcare'),('arist','B2B'),('arketa','B2B'),
  ('arlo-industries','Industrials'),('armorer-labs','B2B'),('arnata','B2B'),('arpari','Fintech'),('arpeggio-bio','Healthcare'),('arpio','B2B'),
  ('array-labs','Industrials'),('artemis-search','B2B'),('artie','B2B'),('artifact-2','B2B'),('artisan','B2B'),('artos','B2B'),
  ('arva-ai','B2B'),('arzana','B2B'),('asakana','B2B'),('asayer','B2B'),('asendia-ai','B2B'),('aseon-labs','Industrials'),
  ('asha-health','Healthcare'),('ashby','B2B'),('asher-bio','Healthcare'),('ashr','B2B'),('aside','Consumer'),('asim','Consumer'),
  ('asim-group','Industrials'),('asimov','Industrials'),('askmyclass-now-soundkins','Education'),('aspect','B2B'),('aspect-inc','B2B'),('assemble','B2B'),
  ('assembly','B2B'),('assembly-com','B2B'),('assembly-hoa','Real Estate and Construction'),('assemblyai','B2B'),('asseta','B2B'),('assistant-ui','B2B'),
  ('astek-diagnostics-inc','Healthcare'),('asterlab','B2B'),('asterline','Fintech'),('asteroid','B2B'),('astor','Fintech'),('astraea','B2B'),
  ('astranis','Industrials'),('astro','Industrials'),('astro-mechanica','Industrials'),('astroforge','Industrials'),('athelas','Healthcare'),('atlas-3','Fintech'),
  ('atlas-discovery','Healthcare'),('atlasgrid','B2B'),('atlia','Real Estate and Construction'),('atlog','B2B'),('atmeto','Industrials'),('atob','Fintech'),
  ('atomarine','Industrials'),('atomic','B2B'),('atomic-industries','Industrials'),('atopile','B2B'),('atrisa','B2B'),('attack-capital','B2B'),
  ('attain','B2B'),('attimet','Fintech'),('attune','B2B'),('attunement','Healthcare'),('atum-works','Industrials'),('aucert','B2B'),
  ('auctor','B2B'),('audora','Consumer'),('augment-inc','B2B'),('aurelian','B2B'),('auricle','Healthcare'),('aurorin-cad','B2B'),
  ('authzed','B2B'),('automat','B2B'),('automax-ai','Real Estate and Construction'),('automorphic','B2B'),('autonomous-technologies-group','Fintech'),('autopallet-robotics','Industrials'),
  ('autoresearch-inc','B2B'),('autosana','B2B'),('autostep','B2B'),('autumn-ai','B2B'),('autumn-labs','Industrials'),('auxos','B2B'),
  ('avallon-ai','Fintech'),('avelis-health','Healthcare'),('avent','B2B'),('averyiq','Real Estate and Construction'),('aviaryai','Fintech'),('aviator','B2B'),
  ('aviern','Industrials'),('avina','B2B'),('avion','Industrials'),('aviro','B2B'),('avoca','B2B'),('avoca-systems','Healthcare'),
  ('avocademy','Education'),('avocado','B2B'),('avoice','B2B'),('avora','Healthcare'),('avout','Fintech'),('awesomic','B2B'),
  ('awtomic','B2B'),('axal','Industrials'),('axel-travel','Consumer'),('axelrod','B2B'),('axial','Industrials'),('axiom','Fintech'),
  ('axiomat','B2B'),('axionorbital-space','Industrials'),('axis','B2B'),('axis-2','Fintech'),('axle','Fintech'),('axle-health','Healthcare'),
  ('axonnic','Industrials'),('azalea-robotics-corporation','Industrials'),('azuki','Consumer'),('b12-labs','Healthcare'),('backdrop','B2B'),('backerkit','B2B'),
  ('backpack','Consumer'),('balance','Fintech'),('bankjoy','Fintech'),('banner','Real Estate and Construction'),('basalt','Industrials'),('baseframe','B2B'),
  ('basepilot','B2B'),('baserun','B2B'),('baud','Industrials'),('bayesline','Fintech'),('baymachines','Industrials'),('bayworks','Industrials'),
  ('bby','Healthcare'),('be-go','B2B'),('beacon-health','Healthcare'),('beacons','Consumer'),('beam','B2B'),('beanstalk','Industrials'),
  ('beesafe-ai','B2B'),('bellabeat','Consumer'),('beluga','B2B'),('belvedir','B2B'),('benchify','B2B'),('benchling','B2B'),
  ('benepass','B2B'),('benson','Fintech'),('bentocart','Consumer'),('bernard','B2B'),('berry','B2B'),('besimple-ai','B2B'),
  ('better-auth','B2B'),('betterbasket','B2B'),('beyond-reach-labs','Industrials'),('bezel','B2B'),('biblo','Consumer'),('bidflow','Real Estate and Construction'),
  ('biggerpicture','B2B'),('bik','B2B'),('bilanc','B2B'),('bild-ai','Real Estate and Construction'),('billiontoone','Healthcare'),('billow-ai-labs','B2B'),
  ('biobot-analytics','Government'),('biocartesian','Healthcare'),('biodelivera','Healthcare'),('biodock','Healthcare'),('biomes','B2B'),('bios-health','Healthcare'),
  ('biostack-platforms','Healthcare'),('birch-biosciences','Industrials'),('birdie','B2B'),('bitboard','B2B'),('bite-ninja','B2B'),('bitesight','Consumer'),
  ('bitmovin','B2B'),('bitrig','B2B'),('bizmark','B2B'),('bland-ai','B2B'),('blank-bio','Healthcare'),('blaze','B2B'),
  ('blee','Fintech'),('blindpay','Fintech'),('blink-new','B2B'),('blinka','Fintech'),('blissway','Government'),('blitz','B2B'),
  ('blixo','B2B'),('bloom-3','Fintech'),('bloom-institute-of-technology','Education'),('bloomapi','Healthcare'),('bloomy','Education'),('blue','Consumer'),
  ('blue-frog-gaming','Consumer'),('blue-onion','B2B'),('blueberry-pediatrics','Healthcare'),('bluecargo','B2B'),('bluedoor','B2B'),('bluedot','Fintech'),
  ('bluehill-payments','B2B'),('bluejay','B2B'),('bluelight','B2B'),('blueshoe','B2B'),('bluma','B2B'),('bluumbio','Healthcare'),
  ('bobidi','B2B'),('bodyport','Healthcare'),('boldvoice','Consumer'),('bolto','B2B'),('bond','B2B'),('booko','B2B'),
  ('boom','Industrials'),('boost-robotics','Industrials'),('boostly','B2B'),('bootloop','B2B'),('botbuilt','Industrials'),('bottomless','Consumer'),
  ('boundary','B2B'),('bountiful','Industrials'),('boxesdev','B2B'),('brainbase-labs','B2B'),('brainboard','B2B'),('brainkey','Healthcare'),
  ('bramante','Industrials'),('bravi','B2B'),('breez-labs','B2B'),('bretton-ai','Fintech'),('brex','Fintech'),('bright','Industrials'),
  ('brighterway','Fintech'),('bristle','Healthcare'),('brite','B2B'),('broccoli-ai','B2B'),('bronco-ai','B2B'),('brown-foods','Healthcare'),
  ('brownie','B2B'),('browser-use','B2B'),('browseros','Consumer'),('bubble-lab','B2B'),('bucket-robotics','Industrials'),('buildbuddy','B2B'),
  ('buildscience','Real Estate and Construction'),('bunkerhill-health','Healthcare'),('bunkyr','B2B'),('bunting-labs','B2B'),('buoyant-aero','Industrials'),('burnt','B2B'),
  ('burt','B2B'),('butter','B2B'),('button-computer','B2B'),('buxfer','Fintech'),('bystreet','B2B'),('byteask','B2B'),
  ('byteport','B2B'),('c16-biosciences','Healthcare'),('cabal','B2B'),('cactus-compute','B2B'),('caddy','B2B'),('cair-health','Healthcare'),
  ('caire-health','Healthcare'),('cairns-health','Healthcare'),('cajal-technologies','B2B'),('caladh','Industrials'),('callab-ai','B2B'),('callback','B2B'),
  ('callbook-ai','B2B'),('calltree','B2B'),('camber-2','Healthcare'),('cambio-2','Real Estate and Construction'),('cambly','Education'),('camelai','B2B'),
  ('campfire-2','B2B'),('canary','B2B'),('canary-technologies','B2B'),('candid-health','Healthcare'),('candidately','B2B'),('candle','Consumer'),
  ('candor','Government'),('candor-security','B2B'),('candoriq','B2B'),('canix','B2B'),('canvas','B2B'),('capacitive','B2B'),
  ('capitol-ai','B2B'),('capix','Fintech'),('captain','B2B'),('captivateiq','B2B'),('capto','B2B'),('capuchin','B2B'),
  ('capveon','Government'),('capy','B2B'),('carbic','Industrials'),('cardinal-gray','Fintech'),('care-weather','Industrials'),('carecycle','B2B'),
  ('careerist','Education'),('careforce','Healthcare'),('caremessage','Healthcare'),('careoasis','Healthcare'),('careswift','Healthcare'),('caretta','B2B'),
  ('cargo','B2B'),('carma','B2B'),('carousel-technologies','B2B'),('carrot-fertility','Healthcare'),('carrot-labs','B2B'),('carsignal','B2B'),
  ('cartage','B2B'),('cartpole','B2B'),('casca','Fintech'),('cascade-space','Industrials'),('caseflood-ai','B2B'),('casey','Fintech'),
  ('cash-flow-portal','Real Estate and Construction'),('cashboard','B2B'),('cashew-labs','B2B'),('castle-2','B2B'),('catchback-cards','Consumer'),('catena-biosciences','Healthcare'),
  ('cb-therapeutics','Healthcare'),('cedalio','B2B'),('cedana','B2B'),('cedar','B2B'),('cekura-ai','B2B'),('cellchorus','Healthcare'),
  ('celltype','Healthcare'),('cembla','B2B'),('cenote','B2B'),('centaur','Healthcare'),('centauri-ai','B2B'),('central-blue','Industrials'),
  ('centralize','B2B'),('cerebrium','B2B'),('certainly-health','Healthcare'),('certus-ai','B2B'),('cerulion','B2B'),('cesara','Healthcare'),
  ('chamber','B2B'),('champ','B2B'),('championeffect-inc','B2B'),('channel3','B2B'),('characterquilt','B2B'),('charge-robotics','Industrials'),
  ('chariot-2','Fintech'),('chart','Fintech'),('chasi','B2B'),('chatfuel','B2B'),('chatwoot','B2B'),('checkr','B2B'),
  ('cheers','B2B'),('cheetah','B2B'),('chempilotai','Industrials'),('chert','B2B'),('chestnut','Fintech'),('chima','B2B'),
  ('chordio','B2B'),('chorus-sleep','B2B'),('chronicle-labs','B2B'),('chrt','B2B'),('cignara','B2B'),('cinapse','B2B'),
  ('cinder-2','B2B'),('circa','B2B'),('circleback','B2B'),('circuitlab','B2B'),('circumvent','Healthcare'),('ciro','B2B'),
  ('cisterna-biologics','Healthcare'),('clad','Real Estate and Construction'),('clad-labs','B2B'),('claim-health','Healthcare'),('claimglide','Healthcare'),('claimkit','B2B'),
  ('claimsorted','Fintech'),('clara-2','Healthcare'),('clarion','Healthcare'),('clarum','B2B'),('classdojo','Education'),('clean','B2B'),
  ('cleanly','Consumer'),('clear-gene','Healthcare'),('clearest-health','Healthcare'),('clearly-ai','B2B'),('clearspace','Consumer'),('clerked','B2B'),
  ('cleva','Fintech'),('cleverdeck','Education'),('click','B2B'),('clicks-health','B2B'),('clidey','B2B'),('clipboard','Consumer'),
  ('clodo','B2B'),('closure','Government'),('cloud-humans','B2B'),('cloudanix','B2B'),('cloudcruise','B2B'),('cloudglue','B2B'),
  ('cmux','B2B'),('coarena','B2B'),('coast','B2B'),('cobbery','B2B'),('coco-wallet','Fintech'),('cocreate','Consumer'),
  ('codag','B2B'),('code-four','Government'),('codeant-ai','B2B'),('codec','Consumer'),('codecombat','Education'),('codecrafters','Consumer'),
  ('codes-health','B2B'),('codevisor','B2B'),('codeviz','B2B'),('codewisp','Consumer'),('cofactor-genomics','Healthcare'),('cofactr','B2B'),
  ('cofia','B2B'),('cognitio-labs','Industrials'),('cognition-ip','B2B'),('cogram','B2B'),('cohesion','B2B'),('cohesive','B2B'),
  ('coil-inc','Consumer'),('coinbase','Fintech'),('cointracker','Fintech'),('coldreach','B2B'),('collar','B2B'),('collectly','Healthcare'),
  ('collectwise','Fintech'),('college-pulse','B2B'),('combinehealth','Healthcare'),('comfy-deploy','B2B'),('commodityai','B2B'),('common-paper','B2B'),
  ('community-phone-company','Consumer'),('complete','B2B'),('compliant-llm','B2B'),('compose-ai','B2B'),('compound-writing','Consumer'),('compresr','B2B'),
  ('computable','Fintech'),('compyle','B2B'),('concord-materials','Real Estate and Construction'),('concourse','B2B'),('conductor-quantum','Industrials'),('conduit','B2B'),
  ('conduit-ai','B2B'),('confetti','Consumer'),('confident-ai','B2B'),('confident-lims','B2B'),('confido','B2B'),('confluence-labs','B2B'),
  ('congruent','Industrials'),('conifer','B2B'),('constant','Fintech'),('constellation-space','B2B'),('constructable','Real Estate and Construction'),('consus','Industrials'),
  ('contextdev','B2B'),('contextfort','B2B'),('contour','B2B'),('contourholdings','Industrials'),('contraforce','B2B'),('contrario','B2B'),
  ('control-seat','Industrials'),('converge','B2B'),('convex','B2B'),('convexia','Healthcare'),('conviction','Fintech'),('coperniq','B2B'),
  ('copia','B2B'),('copper-health','Healthcare'),('copperlane','Fintech'),('copycat-ai','Fintech'),('cora','Consumer'),('corecare','Healthcare'),
  ('corelayer','B2B'),('corgea','B2B'),('corgi','Fintech'),('coris','B2B'),('corsair','B2B'),('cortex','B2B'),
  ('cortex-ai','Industrials'),('corvera','B2B'),('corveus-medical','Healthcare'),('corvus-robotics','Industrials'),('cosmic','B2B'),('cosmic-robotics','Industrials'),
  ('costream','Consumer'),('cotera','B2B'),('cotool','B2B'),('courtyard-io','Consumer'),('cova','Healthcare'),('coval','B2B'),
  ('covera','Fintech'),('coverage-cat','Fintech'),('cozmo-ai','B2B'),('cpgscout','B2B'),('craftwork','Real Estate and Construction'),('craniometrix','Healthcare'),
  ('cranston-ai','B2B'),('cratejoy','B2B'),('creativemode','Consumer'),('credal-ai','B2B'),('crosslayer-labs','B2B'),('crouton','B2B'),
  ('crowdvolt','Consumer'),('crustdata','B2B'),('ctgt','B2B'),('cua','B2B'),('cuebench','B2B'),('culdesac','Real Estate and Construction'),
  ('culture-biosciences','Healthcare'),('cumulus-labs','B2B'),('curebase','Healthcare'),('current','B2B'),('curri','Real Estate and Construction'),('curtsy','Consumer'),
  ('customily','B2B'),('cyberdesk','B2B'),('cyble','B2B'),('cyclon','Consumer'),('d_model','B2B'),('daedalus','Industrials'),
  ('dagger','B2B'),('daily','B2B'),('dailybot','B2B'),('daivin','Industrials'),('dalus','B2B'),('daqstra','B2B'),
  ('daridev','B2B'),('darkgrade','B2B'),('darmiyan','Healthcare'),('dart','B2B'),('dartboard','Industrials'),('darwin-robotics','Industrials'),
  ('data-driven-bioscience','Healthcare'),('databuddy','B2B'),('datacurve','B2B'),('datafold','B2B'),('datafruit','B2B'),('dataglade','Fintech'),
  ('dataland','B2B'),('dataleap','B2B'),('datasaur','B2B'),('datashare','B2B'),('datasuite','B2B'),('datoric','B2B'),
  ('datrics','Healthcare'),('david-ai','B2B'),('dawn-industries','Industrials'),('daybreak-health','Healthcare'),('dayflow','Consumer'),('deako','Consumer'),
  ('decawork','B2B'),('decent-com','Fintech'),('decipher-ai','B2B'),('decisional-ai','B2B'),('decohere','Consumer'),('decuff','Consumer'),
  ('dedalus-labs','B2B'),('deel','B2B'),('deep-interactions','B2B'),('deep24','Education'),('deepaware-ai-robotics-center-of-silicon-valley','Industrials'),('deepgram','B2B'),
  ('deepgrove','B2B'),('deepmark','B2B'),('deepnight','Industrials'),('deepnote','B2B'),('deepreach-inc','B2B'),('deepsim-inc','B2B'),
  ('deeptrace','B2B'),('definite','B2B'),('degla-inc','Industrials'),('delfino-ai','Healthcare'),('delineate','B2B'),('demand-curve','Education'),
  ('demandsphere','B2B'),('den','B2B'),('dench-com','B2B'),('denki','B2B'),('denta','Fintech'),('deploy','Industrials'),
  ('deployparagon','B2B'),('derya','B2B'),('design-arena','Consumer'),('devfast','B2B'),('dex','Consumer'),('dexto','B2B'),
  ('dialtone','B2B'),('diana','B2B'),('diffuse-bio','Healthcare'),('digibuild','Real Estate and Construction'),('digipals','Consumer'),('digitalcarbon','B2B'),
  ('dili','B2B'),('diligencesquared-inc','B2B'),('dill','B2B'),('dime-2','B2B'),('dimely','B2B'),('dinesafe','Healthcare'),
  ('diode-computers-inc','B2B'),('dipole-labs','Industrials'),('directshifts','Healthcare'),('disclo','B2B'),('discovered-materials','Industrials'),('dispatch','Industrials'),
  ('disputeninja','B2B'),('distro','B2B'),('ditto','B2B'),('ditto-biosciences','Healthcare'),('dock','B2B'),('docker','B2B'),
  ('docket','B2B'),('docsum','B2B'),('docura-health','Healthcare'),('dodo','Healthcare'),('doe','B2B'),('domu-technology-inc','B2B'),
  ('donkey','B2B'),('doola','B2B'),('doomersion','Consumer'),('doordash','Consumer'),('dots-2','Fintech'),('double-coding-copilot','B2B'),
  ('double-robotics','B2B'),('doublehq','B2B'),('dover','B2B'),('downlink','B2B'),('dr-treat','Healthcare'),('draft-the-record','B2B'),
  ('draftbit','B2B'),('drafted','Consumer'),('draftwise','B2B'),('dragoneye','B2B'),('drama-drama','Consumer'),('dreach','B2B'),
  ('dream','B2B'),('dream3d','B2B'),('dreamcraft-entertainment-inc','Consumer'),('dreamrp','Consumer'),('dreamscale-labs','Industrials'),('dreamworld','Consumer'),
  ('drillbit','B2B'),('dripos','Fintech'),('driver','B2B'),('dropbox','B2B'),('drymerge','B2B'),('dualizer','B2B'),
  ('duckie','B2B'),('duet-machines','B2B'),('dukesell','B2B'),('duranium','Industrials'),('durate','Healthcare'),('dydema','Consumer'),
  ('dynamite','B2B'),('dynamo-ai','B2B'),('dyneti-technologies','B2B'),('earendil-robotics','Industrials'),('earth-ai','Industrials'),('easypost','B2B'),
  ('ebrandvalue','B2B'),('eclipse-foods','Consumer'),('ecliptor','B2B'),('eden-2','Healthcare'),('eden-robotics','Industrials'),('edge','B2B'),
  ('edgerun','Industrials'),('edgetrace','B2B'),('edotenv','B2B'),('educato','Education'),('edviro','B2B'),('efference','Industrials'),
  ('effigov','Government'),('eggnog','Consumer'),('ego','Consumer'),('egoist-machines','Consumer'),('eigenpal','B2B'),('eight-sleep','Consumer'),
  ('eightsend','B2B'),('ekho','B2B'),('ekho-labs','B2B'),('ekpa','Fintech'),('elayne','Fintech'),('electric-air-2','Real Estate and Construction'),
  ('electroneek','B2B'),('elemeno-health','Healthcare'),('elessar','B2B'),('elevate-2','B2B'),('eligible','Healthcare'),('elimentary','Fintech'),
  ('elip-ai','B2B'),('elite','Healthcare'),('elithia','B2B'),('ellipsis','B2B'),('ello','Education'),('elodin','Industrials'),
  ('eloquent-ai','B2B'),('elythea','Healthcare'),('embark-trucks','Industrials'),('embeddables','B2B'),('embedded-labs','B2B'),('embedder','B2B'),
  ('ember','Healthcare'),('ember-robotics','Industrials'),('emdash','B2B'),('emerge-career','Education'),('emergent','Consumer'),('emobi','B2B'),
  ('emote','Consumer'),('empirical-health','Healthcare'),('enact','Industrials'),('encarte','Fintech'),('endstack','B2B'),('energent-ai','B2B'),
  ('enerjazz','Industrials'),('enhanced-radar','Industrials'),('enjamb-labs','B2B'),('entangl','B2B'),('entelexo-biotherapeutics','Healthcare'),('entropy','Healthcare'),
  ('entvin','Healthcare'),('envariant','B2B'),('envelope','Fintech'),('enveritas','Industrials'),('eos-ai','Healthcare'),('epicenter','Consumer'),
  ('epinoma','Healthcare'),('epsilab-com','B2B'),('epsilon','Education'),('epsilon3-inc','B2B'),('equator-therapeutics','Healthcare'),('equipmentshare','Real Estate and Construction'),
  ('equipt-health','Healthcare'),('ergo','B2B'),('erinys','B2B'),('eris-biotech','Healthcare'),('ernd','Fintech'),('ethos-space-resources','Industrials'),
  ('ethosx','Fintech'),('etleap','B2B'),('eugit-therapeutics','Healthcare'),('evardi','Industrials'),('event-horizon-labs','Fintech'),('eventual','B2B'),
  ('ever-loved','Consumer'),('everest','B2B'),('evergrove','Healthcare'),('every','B2B'),('evident-machines','B2B'),('evie','Consumer'),
  ('evolve-makers-of-podcast-app-and-rest','Consumer'),('evoly','Industrials'),('exa','B2B'),('excellence-learning','Education'),('excepgen','Healthcare'),('executor','B2B'),
  ('exin-therapeutics','Healthcare'),('exla','B2B'),('exonic','Healthcare'),('exosat','Industrials'),('expand-ai','B2B'),('expected-parrot','B2B'),
  ('expent-inc','B2B'),('experiential-labs','B2B'),('experiment','Healthcare'),('explo','B2B'),('expo','B2B'),('extend','B2B'),
  ('extern','Consumer'),('eze','B2B'),('f2','B2B'),('f4-industries','Industrials'),('fabraix','B2B'),('faire','B2B'),
  ('faraday','Industrials'),('farcast','Industrials'),('farel','B2B'),('fastgen','B2B'),('fastjvm','B2B'),('fazeshift','B2B'),
  ('feanix-biotechnologies','Industrials'),('feather-2','B2B'),('fed10','B2B'),('feldy','B2B'),('fenrock-ai','Fintech'),('fernstone','Fintech'),
  ('ferveret-inc','Industrials'),('fetii','Consumer'),('feyn','B2B'),('fiber-ai','B2B'),('ficra','B2B'),('fidocure','Healthcare'),
  ('fieldguide','B2B'),('fifth-door','Consumer'),('fightcamp','Consumer'),('filta','Consumer'),('financial-datasets','B2B'),('finch','B2B'),
  ('finic','Fintech'),('finlens','B2B'),('finn','Fintech'),('finny-ai','Fintech'),('finosu','Fintech'),('finta','B2B'),
  ('fire-wallet','Fintech'),('firebender','B2B'),('firecrawl','B2B'),('firezone','B2B'),('first','B2B'),('firstbase-io','B2B'),
  ('firstwork','B2B'),('fivetran','B2B'),('fixa','B2B'),('flagright','B2B'),('flai','Industrials'),('flair-labs','B2B'),
  ('flashdrive','B2B'),('fleetline','B2B'),('fleetworks','B2B'),('fleety','B2B'),('fleetzero','Industrials'),('flexdesk','B2B'),
  ('flexport','B2B'),('flexwash','B2B'),('flick','Consumer'),('flightfox','B2B'),('flint-2','Education'),('flip','Consumer'),
  ('flo','B2B'),('float','Fintech'),('float-health','Healthcare'),('flock-safety','B2B'),('flockjay','B2B'),('floot','B2B'),
  ('floracene','Healthcare'),('florin','Fintech'),('flow-club','B2B'),('flowbot','B2B'),('floweq','B2B'),('flower-co','Consumer'),
  ('flowglad','B2B'),('flowly','Healthcare'),('flowmanual','Real Estate and Construction'),('flowscope','B2B'),('flowspace','B2B'),('flowtel','B2B'),
  ('fluently','Consumer'),('fluid-markets','Fintech'),('flutterflow','B2B'),('fluxcap','B2B'),('fly-io','B2B'),('flycode','Fintech'),
  ('flywheel-ai','Industrials'),('foaster','B2B'),('focal-systems','B2B'),('fogbender','B2B'),('followupthen','B2B'),('fondo','B2B'),
  ('font-awesome','B2B'),('forage-2','Fintech'),('foreman','Real Estate and Construction'),('forerunner','Industrials'),('foreshadow-industries','Industrials'),('foresight','B2B'),
  ('forever-labs','Healthcare'),('forge','B2B'),('forge-rewards','B2B'),('forge-robotics','Industrials'),('formal','B2B'),('formula-insight','B2B'),
  ('fort','Consumer'),('fortuna-health','Healthcare'),('forum','Fintech'),('foundation-2','Real Estate and Construction'),('foundation-industries','Industrials'),('four-growers','Industrials'),
  ('fours','B2B'),('fractal-labs','Consumer'),('fractional','Fintech'),('framewise-health','Healthcare'),('freebuff','B2B'),('freeport-markets','Fintech'),
  ('freesolo','B2B'),('freestyle','B2B'),('freestyle-ai','Consumer'),('frekil','Healthcare'),('fresco','Real Estate and Construction'),('freshpaint','B2B'),
  ('frigade','B2B'),('frizzle','Education'),('front','B2B'),('frontrunner','B2B'),('fuchsia','B2B'),('fulcrum','B2B'),
  ('function-of-beauty','Consumer'),('fundersclub','Fintech'),('furtherai','B2B'),('fuse-ai','B2B'),('futureclinic','Healthcare'),('fynn','Fintech'),
  ('g-lnk','B2B'),('gaiia','B2B'),('gainful','Consumer'),('gale','B2B'),('galini','B2B'),('gamebytes','Consumer'),
  ('gamgee','Healthcare'),('garage-2','B2B'),('gas-pos','Fintech'),('gather-2','Consumer'),('gatherhq','B2B'),('gauge','B2B'),
  ('gauss','Fintech'),('gbrain','B2B'),('gecko-robotics','Industrials'),('gemnote','B2B'),('gen1e-lifesciences','Healthcare'),('general-aviation-company','Industrials'),
  ('general-context-labs','Consumer'),('general-instinct','Industrials'),('general-proximity','Healthcare'),('general-trajectory','Industrials'),('generalastro','Industrials'),('genomelink','Healthcare'),
  ('gentle-health','Healthcare'),('genuity','B2B'),('geo-ai','B2B'),('geostar','B2B'),('gerald-technologies-inc','Fintech'),('getasap','B2B'),
  ('getcho','B2B'),('getcrux','B2B'),('ghosteye','B2B'),('giga','B2B'),('gigs','B2B'),('gigwell','B2B'),
  ('gilgamesh-pharmaceuticals','Healthcare'),('ginkgo-bioworks','Healthcare'),('gitcafe','B2B'),('gitlab','B2B'),('gitstart','B2B'),('givecampus','Education'),
  ('giveffect','B2B'),('givefront','Fintech'),('glade','B2B'),('gleam','Healthcare'),('glen','B2B'),('glep','Fintech'),
  ('glide','B2B'),('glimpse-2','B2B'),('gloglo','Consumer'),('glowing-io','B2B'),('goat-group','Consumer'),('godela','B2B'),
  ('godhands','B2B'),('godpack','Consumer'),('gogograndparent','Consumer'),('goldbelly','Consumer'),('golf','B2B'),('golinks','B2B'),
  ('golpo','B2B'),('goodcover','Fintech'),('goodfin','Fintech'),('goodshelf','Consumer'),('gooseworks','B2B'),('govdash','Government'),
  ('goveagle','Government'),('govly','Government'),('grade','Fintech'),('gradia-health','Healthcare'),('gradon','B2B'),('grain','Fintech'),
  ('granza-bio','Healthcare'),('graphide','B2B'),('graphify-labs','B2B'),('gravy','Fintech'),('great-question','B2B'),('green-canopy-node','Real Estate and Construction'),
  ('greenboard','Fintech'),('greentoe','Consumer'),('grep-ai','B2B'),('greptile','B2B'),('grey','Fintech'),('greypoint-industries','Industrials'),
  ('gridware','Industrials'),('grocalo','Consumer'),('groundcontrol','Industrials'),('groundmail','B2B'),('growthbook','B2B'),('gru-space','Industrials'),
  ('grubmarket','B2B'),('guac','B2B'),('guardian-bio','Healthcare'),('guardian-rf','Industrials'),('guesty','Real Estate and Construction'),('guide-labs','B2B'),
  ('guild','Industrials'),('gumloop','B2B'),('gusto','B2B'),('gutgutgoose','Healthcare'),('gym-class','Consumer'),('h1','Healthcare'),
  ('h3x-technologies','Industrials'),('habit','B2B'),('habu','Real Estate and Construction'),('hackerrank','B2B'),('hadrius','Fintech'),('haladir','B2B'),
  ('halluminate','B2B'),('hamming-ai','B2B'),('hammr','B2B'),('handl','B2B'),('handle','Real Estate and Construction'),('handled','B2B'),
  ('handoff','Real Estate and Construction'),('hapi','Fintech'),('haplotype-labs','Healthcare'),('happenstance','Consumer'),('happyrobot','B2B'),('harbera','Healthcare'),
  ('hardware-intelligence','B2B'),('harmonic-discovery','Healthcare'),('harnessrouter','B2B'),('harper','Fintech'),('hatchet-run','B2B'),('haven','Fintech'),
  ('haven-2','B2B'),('haystack','B2B'),('haystackeditor','B2B'),('hazel-2','Government'),('healia','Fintech'),('health-harbor','Healthcare'),
  ('healthkey','Healthcare'),('healthsherpa','Healthcare'),('healthspark','Healthcare'),('heap','B2B'),('heart-aerospace','Industrials'),('heartbyte','Consumer'),
  ('hebbian-robotics','Industrials'),('hedge','Fintech'),('hedgehog-2','Industrials'),('hegel-ai','B2B'),('helion-energy','Industrials'),('helios-intelligence','Healthcare'),
  ('helium','B2B'),('helix-nanotechnologies','Healthcare'),('hellometer','B2B'),('helonic','Real Estate and Construction'),('hemlock','Industrials'),('hemut','B2B'),
  ('henry-2','Real Estate and Construction'),('hepatx','Healthcare'),('hermes-robotics','Industrials'),('heron','Fintech'),('hesper-ai','Fintech'),('hestus-inc','B2B'),
  ('hevn-inc','Fintech'),('hexclave','B2B'),('heyclicky','Consumer'),('hickory-and-company','B2B'),('hightouch','B2B'),('hillclimb','B2B'),
  ('hillstar','B2B'),('hilstart','Industrials'),('hindsight','B2B'),('hioperator','B2B'),('hippo-scribe','Healthcare'),('hireart','B2B'),
  ('hiro','B2B'),('hiro-industries','Industrials'),('histowiz','Healthcare'),('hlabs','Industrials'),('hockeystack','B2B'),('hokali','B2B'),
  ('holy-grail-inc','B2B'),('homli','Real Estate and Construction'),('hona','B2B'),('honeylove','Consumer'),('hop-aero','Industrials'),('hoplite','B2B'),
  ('hopper','B2B'),('hotglue','B2B'),('hotplate','Consumer'),('housewarming','Consumer'),('howdy-com','B2B'),('hub-labs','Industrials'),
  ('hubble-ai','Healthcare'),('hubble-network','Industrials'),('hud','B2B'),('hudu','B2B'),('hue','B2B'),('human-archive','Industrials'),
  ('human-behavior','B2B'),('human-dx','Healthcare'),('human-interest','B2B'),('humand','B2B'),('humane-genomics','Healthcare'),('humanly','B2B'),
  ('humoniq','B2B'),('humwork','B2B'),('hundred','Industrials'),('hybrd','Consumer'),('hype','Consumer'),('hype-and-vice','Consumer'),
  ('hyper-4','B2B'),('hyperbench','B2B'),('hyperbound','B2B'),('hyperbrowser','B2B'),('hypercubic','B2B'),('hyperdesk','B2B'),
  ('hyperprobe','B2B'),('hyperspell','B2B'),('hypertrader','Fintech'),('hypotenuse-ai','B2B'),('hyrex','B2B'),('icarus','Industrials'),
  ('idemeum','B2B'),('idler','B2B'),('ignition-benefits','Fintech'),('illume-labs','Healthcare'),('illuminant-surgical','Healthcare'),('imagine-ai','B2B'),
  ('imgix','B2B'),('impact-drones','Industrials'),('imperfect','Consumer'),('impossible-metals','Industrials'),('impractical','B2B'),('imprezia','B2B'),
  ('in-the-room','Consumer'),('inbuild','B2B'),('incandor','B2B'),('increase','Fintech'),('indee-labs','Healthcare'),('indemni','B2B'),
  ('index-law','B2B'),('indinero','B2B'),('induction-labs','B2B'),('industrial-microbes','Healthcare'),('industrial-next','Industrials'),('inevent','B2B'),
  ('infera','Healthcare'),('infield','B2B'),('infina','Fintech'),('infinite','Fintech'),('infisical','B2B'),('infiuss-health','B2B'),
  ('inflection-space-systems','Industrials'),('influxdata','B2B'),('inkbox','B2B'),('inkeep','B2B'),('inlet-2','B2B'),('innate','Consumer'),
  ('inpharmd','Healthcare'),('inquery-2','Healthcare'),('inscribe','B2B'),('insoma-bio','Healthcare'),('inspectify','Real Estate and Construction'),('inspectmind-ai','Real Estate and Construction'),
  ('instaagent','B2B'),('instabox','B2B'),('instacart','Consumer'),('instakin','Fintech'),('instalab','Healthcare'),('instapath-inc','Healthcare'),
  ('instawork','B2B'),('instinct-xyz','Fintech'),('instrumentl','B2B'),('insurf','Healthcare'),('intact-therapeutics','Healthcare'),('integrated-reasoning','B2B'),
  ('integuru','B2B'),('intelligence-factory','Industrials'),('interfaze','B2B'),('interfere','B2B'),('intryc','B2B'),('intuned','B2B'),
  ('inventive-ai','B2B'),('inventoryquant','B2B'),('inversion-semiconductor','Industrials'),('inversion-space','Industrials'),('invert','Healthcare'),('invertix','Industrials'),
  ('invision-medical-technology','Healthcare'),('iomete','B2B'),('iotflows-inc','B2B'),('irbc','Fintech'),('iron-grid','Industrials'),('ironclad','B2B'),
  ('ironledger-ai','Real Estate and Construction'),('isabl','Healthcare'),('isengard-industries-inc','Industrials'),('isono-health','Healthcare'),('isoquant','B2B'),('issen','Consumer'),
  ('item','B2B'),('janeen','Healthcare'),('jarmin','B2B'),('jasper-ai','B2B'),('jcode','Consumer'),('jeeves','Fintech'),
  ('jeevy-fabrication','B2B'),('jerry-inc','Fintech'),('jestor','B2B'),('jetlenses','Healthcare'),('jetpack-aviation','Industrials'),('jitx','Industrials'),
  ('jo','Consumer'),('joinlore','B2B'),('joinmarble','B2B'),('joon-health','Healthcare'),('jovian','Education'),('joy','Consumer'),
  ('juicebox','B2B'),('julius','B2B'),('jumpcut','Education'),('jumpstart','Fintech'),('junction-bioscience','Healthcare'),('jupiter','B2B'),
  ('just-appraised','Government'),('justai','B2B'),('juxta','B2B'),('kaigo-health','Healthcare'),('kaipod-learning','Education'),('kairos','B2B'),
  ('kairos-health','Healthcare'),('kairox-systems','Industrials'),('kaiten','Consumer'),('kaizen','B2B'),('kalinda','B2B'),('kalpa-labs','B2B'),
  ('kalshi','Fintech'),('kanopy','Industrials'),('kara','Industrials'),('karat-financial','Fintech'),('karate-labs','B2B'),('karmen','Real Estate and Construction'),
  ('karsa','Fintech'),('kashikoi','B2B'),('kastle','B2B'),('kater-ai','B2B'),('kebra','B2B'),('keeper-2','Fintech'),
  ('keet','Consumer'),('keiki','B2B'),('kelai','Fintech'),('keres','Industrials'),('kern-systems','Healthcare'),('kernal-biologics','Healthcare'),
  ('kernel','B2B'),('kestral','B2B'),('kestrel-ai','B2B'),('kestroll','Consumer'),('key-values','B2B'),('keye','Fintech'),
  ('keyframe-labs','B2B'),('keylika','Healthcare'),('keystroke','B2B'),('khoj','Consumer'),('kilvin','B2B'),('kimpton','Fintech'),
  ('kinect','B2B'),('kingdom','Healthcare'),('kino-ai','B2B'),('kinro','Fintech'),('kinter','B2B'),('kita','Fintech'),
  ('kite','B2B'),('kivo-health','Healthcare'),('kiwi','B2B'),('kiwi-biosciences','Healthcare'),('klaimee','Fintech'),('klarify','Healthcare'),
  ('knowlify','B2B'),('knowtex','Healthcare'),('koala','Education'),('kobalt-labs','B2B'),('kodex','B2B'),('kontigo','Fintech'),
  ('kopra-bio','Healthcare'),('korso','B2B'),('koyal','Consumer'),('koywe','Fintech'),('kura-ai','B2B'),('kyber','B2B'),
  ('labdoor','Consumer'),('labric','B2B'),('ladderai','B2B'),('lago','B2B'),('lakonia','Government'),('lamar-health','Healthcare'),
  ('lamb-labs','B2B'),('lamina-labs','B2B'),('laminar-com','B2B'),('laminate','Fintech'),('lance','B2B'),('lancedb','B2B'),
  ('landed-2','B2B'),('lanesurf','B2B'),('lantern-ai','B2B'),('lapel','B2B'),('lapis','B2B'),('lark','B2B'),
  ('lark-2','Industrials'),('latchel','B2B'),('latent','Healthcare'),('lato','B2B'),('latted','B2B'),('lattice','B2B'),
  ('lattice-health','Healthcare'),('launchflow','B2B'),('laurence','B2B'),('lawdingo','Consumer'),('layers','Healthcare'),('layerup','B2B'),
  ('laylo','B2B'),('leadbay','B2B'),('leadgenius','B2B'),('leah-labs','Healthcare'),('leaping','B2B'),('leaping-ai','B2B'),
  ('ledger-investing','Fintech'),('ledgerup','B2B'),('leena-ai','B2B'),('legacy','Healthcare'),('legalist','Fintech'),('legalos','B2B'),
  ('legion-health','Healthcare'),('lemonbox','Healthcare'),('lemonlime','B2B'),('lemonslice','B2B'),('lendflow','Fintech'),('lendtable','Fintech'),
  ('leon-and-george','Consumer'),('letter-ai','B2B'),('letter-dev','B2B'),('letterbook','B2B'),('letterdrop','B2B'),('level-frames','Consumer'),
  ('levocred-ai','Fintech'),('levro','Fintech'),('lexi','B2B'),('lexius','B2B'),('lfcarry','Consumer'),('libra-robotics','Industrials'),
  ('lifeat','Consumer'),('light-anchor','Consumer'),('lightberry','Industrials'),('lighthouz-ai','B2B'),('lightscreen-ai','B2B'),('lightski','B2B'),
  ('lightsprint','B2B'),('lighttwist','B2B'),('ligo-biosciences','Healthcare'),('lilac','B2B'),('limnion','B2B'),('limrun','B2B'),
  ('linc','B2B'),('lineleap','Consumer'),('linewise','Industrials'),('lingodotdev','B2B'),('lingt','Education'),('linkgrep','B2B'),
  ('linklane','B2B'),('linum','Consumer'),('linzumi','B2B'),('lion-pose','Consumer'),('liquid-compute','Fintech'),('listia','Consumer'),
  ('litellm','B2B'),('litmus-hiring','B2B'),('litnerd','Education'),('liv-labs-inc','Healthcare'),('liva-ai','B2B'),('liveflow','B2B'),
  ('lively-inc','Healthcare'),('living-carbon','Industrials'),('liyfe','Healthcare'),('llm-stats','B2B'),('lob','B2B'),('locale','Consumer'),
  ('locata','Healthcare'),('locke','B2B'),('locus','B2B'),('lofty','Fintech'),('logarithm-labs','B2B'),('logica','B2B'),
  ('logical','B2B'),('logisticsos','B2B'),('logosguard','B2B'),('lollipuff','Consumer'),('long-term-stock-exchange','Fintech'),('loom','Consumer'),
  ('loopfour','Fintech'),('loops','B2B'),('lootrush','Fintech'),('lopus','B2B'),('lotas','B2B'),('loula','Healthcare'),
  ('luca-iq','B2B'),('lucent','B2B'),('lucible','B2B'),('lucid','Consumer'),('lucid-bots','Industrials'),('lucidic-ai','B2B'),
  ('lucira-health','Healthcare'),('lucy-goods-inc','Consumer'),('luel','B2B'),('lugg','Consumer'),('lumari','B2B'),('lumeria','Healthcare'),
  ('luminai','B2B'),('luminal','B2B'),('luminary','B2B'),('lumius','Healthcare'),('lunabill','Healthcare'),('lunajoy-health','Healthcare'),
  ('luthor','B2B'),('lux-foods','Industrials'),('lygg','Consumer'),('lygos','Healthcare'),('lyon','B2B'),('lyra','Consumer'),
  ('mach9','B2B'),('machine0','B2B'),('macromoltek','Healthcare'),('madethis','B2B'),('madrone','Industrials'),('mage-legal','B2B'),
  ('magic','B2B'),('magic-hour','Consumer'),('magic-loops','B2B'),('magic-patterns','B2B'),('magicbus','Consumer'),('magicode','B2B'),
  ('magma','B2B'),('magnetic','B2B'),('magnitude','B2B'),('maia','Healthcare'),('maingen','Industrials'),('maintouch','B2B'),
  ('makani-science','Healthcare'),('makeasite','Consumer'),('makrwatch','B2B'),('malama-health','Healthcare'),('manara','B2B'),('mango-medical-inc','Healthcare'),
  ('mangodesk','B2B'),('manicule','B2B'),('manifold-2','Industrials'),('manifold-freight','B2B'),('mantis','B2B'),('mantle-machines','Industrials'),
  ('manufact','B2B'),('manufacturingintelligence','Industrials'),('maple-materials','Industrials'),('maquoketa-research','B2B'),('marengo','Industrials'),('margin','B2B'),
  ('maritime','B2B'),('maritime-fusion','Industrials'),('mark-cuban-cost-plus-drug-company-pbc','Healthcare'),('marker','B2B'),('markhor','Consumer'),('markit','B2B'),
  ('markov','B2B'),('marqvision','B2B'),('marr-labs','B2B'),('martini','B2B'),('mashgin','B2B'),('mason','B2B'),
  ('mass-magnetics','Industrials'),('massdriver','B2B'),('masterpiece','Fintech'),('mastra','B2B'),('matano','B2B'),('mathos','Education'),
  ('matrubials-inc','Healthcare'),('matter','Consumer'),('mattermost','B2B'),('matterport','Consumer'),('maven','B2B'),('maven-bio','B2B'),
  ('maverickx','Industrials'),('maxi','Fintech'),('maximal','B2B'),('may-mobility','Industrials'),('mayan','B2B'),('mayflower','Government'),
  ('maywood','Fintech'),('mbodi-ai','Industrials'),('mbx','Consumer'),('mdhub','Healthcare'),('meadow','B2B'),('measured','Healthcare'),
  ('mecha-health','Healthcare'),('mecho-autotech','Industrials'),('medcrypt','Healthcare'),('mederva','Healthcare'),('medicare-vox-fka-fair-square','Healthcare'),('medigram','Healthcare'),
  ('medium-biosciences','Healthcare'),('medmonk','Healthcare'),('mednet','Healthcare'),('medplum','Healthcare'),('meitre','B2B'),('melder','B2B'),
  ('melty-gg','Consumer'),('mem0','B2B'),('memberstack','Fintech'),('memoir','B2B'),('memorable','B2B'),('memory-store','B2B'),
  ('mendelia','Healthcare'),('mentalhappy','Healthcare'),('menten-ai','Healthcare'),('mentra','Consumer'),('mercoa','Fintech'),('mergent','B2B'),
  ('merlin-ai','B2B'),('meru-health','Healthcare'),('mesh','B2B'),('mesh-2','B2B'),('metal','B2B'),('metalcraft','B2B'),
  ('metalware','B2B'),('meteor-labs','B2B'),('meteoric','Industrials'),('meter-feeder','Fintech'),('method','B2B'),('method-financial','Fintech'),
  ('meticulate','B2B'),('metriport','Healthcare'),('mezmo','B2B'),('mica-ai','B2B'),('micora','Industrials'),('microhealth','Healthcare'),
  ('micsi','Healthcare'),('middesk','B2B'),('middleware','B2B'),('midrender','B2B'),('million','B2B'),('million-marker','Healthcare'),
  ('mimos','B2B'),('mindfort','B2B'),('mindsdb','B2B'),('mindstate-design-labs','Healthcare'),('mineflow','Industrials'),('minerva','B2B'),
  ('minicor','B2B'),('miniswap','Consumer'),('mino-games','Consumer'),('minro','B2B'),('mintlify','B2B'),('minusx','B2B'),
  ('mio','B2B'),('miracle','Healthcare'),('mireye','B2B'),('mirror-ai','Consumer'),('mirrors','B2B'),('miru-ml','B2B'),
  ('miso-labs','B2B'),('misprint','Consumer'),('mito','B2B'),('mito-health','Healthcare'),('mixerbox','Consumer'),('mixpanel','B2B'),
  ('miyagi-labs','Education'),('mnemonic-labs','B2B'),('mobileboost','B2B'),('mobius-materials','Industrials'),('mobot','B2B'),('mochacare','B2B'),
  ('mochatrade','Fintech'),('mochi','Consumer'),('moda','B2B'),('modelence','B2B'),('modern-health','Healthcare'),('modern-treasury','B2B'),
  ('modernloop','B2B'),('modus','B2B'),('moichor','Healthcare'),('momentic','B2B'),('momentus','Industrials'),('monarcha','B2B'),
  ('monet','Fintech'),('monte','B2B'),('monumint','B2B'),('moonset-health','B2B'),('moonshine','B2B'),('moonshot-computer','Consumer'),
  ('moreta','Fintech'),('morph','B2B'),('morphik','B2B'),('morphoai','Industrials'),('mosaic-2','Consumer'),('mosaic-inc','B2B'),
  ('mosaicvoice','B2B'),('moss','B2B'),('most-robotic','Industrials'),('mousecat','B2B'),('movedot','B2B'),('moving-atoms','Industrials'),
  ('mozart-data','B2B'),('mspilot','B2B'),('mtailor','Consumer'),('mth-sense','B2B'),('multifactor','B2B'),('multiplier','B2B'),
  ('multiply-labs','Industrials'),('munify','Fintech'),('musicarena','B2B'),('mutiny','B2B'),('mux','B2B'),('myria','Consumer'),
  ('nabis','B2B'),('nabla-bio','Healthcare'),('naive','B2B'),('nala','Fintech'),('names-and-faces','B2B'),('nango','B2B'),
  ('nanocorp','Consumer'),('nanonets','B2B'),('narrative','B2B'),('nash','B2B'),('nash-2','Fintech'),('native','B2B'),
  ('naturall-club','Consumer'),('nautilus','B2B'),('navattic','B2B'),('navier-ai','Industrials'),('ncompass-technologies','B2B'),('nearwave','Healthcare'),
  ('nebullam-dba-clayton-farms','Consumer'),('nebusec','B2B'),('nectar','Industrials'),('nectome','Healthcare'),('neomatter','B2B'),('nephrogen','Healthcare'),
  ('nessie','B2B'),('nest-genomics','Healthcare'),('nestor','B2B'),('netbeez','B2B'),('netmaker','B2B'),('netomi','B2B'),
  ('nettrons','Consumer'),('networkocean','Industrials'),('neuromorphic','Industrials'),('neuron-industries','Industrials'),('new-story','Real Estate and Construction'),('newsblur','Consumer'),
  ('newton','B2B'),('nex','B2B'),('nexgent','Education'),('nextera-robotics-didgeai','Industrials'),('nimbic-ai','B2B'),('nimble','Education'),
  ('nimblerx','Healthcare'),('nine-fives','Industrials'),('nines','Industrials'),('ninite','B2B'),('nirva','Healthcare'),('nitrode','B2B'),
  ('nixo','B2B'),('no-logo','B2B'),('nobell-foods','Consumer'),('nodus-compute','B2B'),('nomi','B2B'),('noora-health','Healthcare'),
  ('nori','Healthcare'),('noril1','Industrials'),('normal','Industrials'),('norra','Healthcare'),('noso-labs','Industrials'),('notabene','B2B'),
  ('notable-labs','Healthcare'),('notte','B2B'),('nourish','Healthcare'),('nova-credit','Fintech'),('novaflow','Healthcare'),('novelcare','Healthcare'),
  ('novig','Consumer'),('novoflow','Healthcare'),('nowadays','B2B'),('nox-metals','Industrials'),('noya-software','B2B'),('nozomio','Consumer'),
  ('nuanced','Consumer'),('nucleo','Healthcare'),('null-labs','Industrials'),('nullstone','B2B'),('numen','Healthcare'),('numeral','B2B'),
  ('numerion-labs','Healthcare'),('numero','Fintech'),('nuvocargo','B2B'),('nuvola','Industrials'),('nxtcure-labs','Healthcare'),('nyckel','B2B'),
  ('o11','B2B'),('oasive','Fintech'),('obento-health','Healthcare'),('obia','Real Estate and Construction'),('observant-ai','B2B'),('observe-ai','B2B'),
  ('obsessiondb','B2B'),('octapulse','Industrials'),('octavewealth','B2B'),('octolane-ai','B2B'),('ocular-ai','B2B'),('oda','B2B'),
  ('odeko','B2B'),('odigos-technologies-inc','B2B'),('odin-robotics','Industrials'),('odo','B2B'),('odys-aviation','Industrials'),('offbeast','Consumer'),
  ('offdeal','B2B'),('offstream','B2B'),('ohm-2','Industrials'),('ohmic-biosciences','Industrials'),('oki','Consumer'),('okibi','B2B'),
  ('oklo','Industrials'),('okteto','B2B'),('olam-labs','B2B'),('olark','B2B'),('ollama','B2B'),('olympian-motors','Industrials'),
  ('oma-care','Healthcare'),('omanta','Healthcare'),('omnara','B2B'),('omnistrate','B2B'),('onboard-io','B2B'),('oncactus','B2B'),
  ('oncobox','Healthcare'),('one-robot','Industrials'),('onebrief','B2B'),('onechronos','Fintech'),('onegrep','B2B'),('oneschema','B2B'),
  ('onesignal','B2B'),('onestop','Consumer'),('onetext','Fintech'),('onetriangle','B2B'),('onlook','B2B'),('onshore','B2B'),
  ('ontop','B2B'),('ontra-mobility','Government'),('ooak-data','B2B'),('opalite-health','Healthcare'),('open-actuation','Industrials'),('openbenchmarks','B2B'),
  ('openbiome','Healthcare'),('opencrawl','B2B'),('openhack','B2B'),('openintake','B2B'),('openlake-technologies','B2B'),('openlayer','B2B'),
  ('openmart','B2B'),('openphone','B2B'),('openrelay','B2B'),('openscaffold','B2B'),('opensea','Consumer'),('openspec','B2B'),
  ('opensteer','B2B'),('opentag','B2B'),('opentools','B2B'),('opentrons','Healthcare'),('openvector','B2B'),('openwork','B2B'),
  ('openwrench','B2B'),('opera','B2B'),('operand','B2B'),('operatorio','B2B'),('operon','Industrials'),('ophelia','Healthcare'),
  ('opslane','B2B'),('ora-ai','Education'),('orange-slice','B2B'),('orangewood-labs','Industrials'),('orbital-operations','Industrials'),('orca','Fintech'),
  ('orca-aerospace','Industrials'),('orca-client','Consumer'),('orchestra','B2B'),('orchid','Healthcare'),('ordo-labs','Healthcare'),('organizely','B2B'),
  ('orgo','B2B'),('orgorg','B2B'),('origami-2','B2B'),('origami-robotics','Industrials'),('origami-therapeutics-inc','Healthcare'),('origin-bio','Healthcare'),
  ('orikata-bio-pbc','B2B'),('ornadyne','Industrials'),('orthogonal','B2B'),('os3','Industrials'),('osmaura','B2B'),('osmind','Healthcare'),
  ('osmosis','B2B'),('ossus','B2B'),('outerport','B2B'),('outlit','B2B'),('output-labs','Healthcare'),('outrival-inc','B2B'),
  ('outrove','B2B'),('outschool','Education'),('outset','B2B'),('outship','B2B'),('outworld-labs','B2B'),('overdrive-health','Healthcare'),
  ('overeasy','B2B'),('overheard','B2B'),('overlap','B2B'),('overlord','Consumer'),('overshoot','B2B'),('overstand-labs','B2B'),
  ('overview','Industrials'),('overwatch','B2B'),('oway','B2B'),('ownlocal','B2B'),('owny','Fintech'),('oximy','B2B'),
  ('oxus','B2B'),('oxygen','Fintech'),('paceline-bio','Healthcare'),('paces','Industrials'),('pacific','Industrials'),('padlet','B2B'),
  ('pagerduty','B2B'),('pair-team','Healthcare'),('paladin','Industrials'),('palette-2','B2B'),('palisade','B2B'),('palisade-2','B2B'),
  ('pally','B2B'),('palmier','Consumer'),('paloma','B2B'),('pana','Fintech'),('panacea','Healthcare'),('pando-bioscience','Healthcare'),
  ('panels','B2B'),('panelytic','Fintech'),('pangea-app','B2B'),('pango','B2B'),('pangolin','B2B'),('panoptive','B2B'),
  ('panora','B2B'),('panorama-education','Education'),('panta','Fintech'),('papa','Healthcare'),('papaya','B2B'),('paper-instruments','B2B'),
  ('paper-star','B2B'),('paradedb','B2B'),('paradev','B2B'),('paradigm','B2B'),('paragon','B2B'),('paragon-ai','B2B'),
  ('parahelp','B2B'),('parallel-bio','Healthcare'),('parameter','B2B'),('parametric','Industrials'),('paraquery','B2B'),('parasma','B2B'),
  ('paratus-health','Healthcare'),('parcelbio','Healthcare'),('pardes-bio','Healthcare'),('parea','B2B'),('pares-ai','Real Estate and Construction'),('parley','B2B'),
  ('parrot','Consumer'),('parsagon','B2B'),('parse-bot','B2B'),('partcl','B2B'),('particularity','Government'),('partna','Fintech'),
  ('partnerhq','B2B'),('party','B2B'),('pasito','Fintech'),('patched','B2B'),('patent-watch','B2B'),('pathpilot','B2B'),
  ('patientdeskai','Healthcare'),('patternfast-prior-tailornovacouturme','B2B'),('pave-2','B2B'),('pave-robotics','Industrials'),('pavoot','B2B'),('pax','B2B'),
  ('pax-historia','Consumer'),('pax-markets','Fintech'),('payna','B2B'),('pearson-labs','B2B'),('peer','B2B'),('pelago','Healthcare'),
  ('pelica','Healthcare'),('penciled','Healthcare'),('pennant','Fintech'),('people-ai','B2B'),('peppr-ai','B2B'),('per-diem','B2B'),
  ('perceptive-technologies','Healthcare'),('perceptron-ml','B2B'),('perceptual-labs','B2B'),('perfectbit-inc','Industrials'),('perfectly','B2B'),('peritai','B2B'),
  ('perlara','Healthcare'),('permitflow','Real Estate and Construction'),('permitify','Real Estate and Construction'),('permitportal','Real Estate and Construction'),('persephone-biosciences','Healthcare'),('perseus-defense','Industrials'),
  ('persist-ai','Healthcare'),('perspectives-health','Healthcare'),('pesto','Fintech'),('petcube','Consumer'),('petrarch','B2B'),('petrichor','B2B'),
  ('pgdog','B2B'),('pharos','Healthcare'),('phases','Industrials'),('philon','Industrials'),('phone-harness','B2B'),('photonium','B2B'),
  ('phykos','Industrials'),('physical-turing','Industrials'),('pibit-ai','Fintech'),('pickle-2','Consumer'),('picktrace','Industrials'),('picnicai','Healthcare'),
  ('pier','B2B'),('pierre','B2B'),('pigeon','B2B'),('pillar','Healthcare'),('pillar-2','Consumer'),('pine-park-health','Healthcare'),
  ('pingo','Consumer'),('pinnacle','B2B'),('pipeshift','B2B'),('piramidal','Healthcare'),('pirislabs','B2B'),('pirouette-pharma','Healthcare'),
  ('pirros','B2B'),('pivot-robotics','Industrials'),('pixley-ai','Consumer'),('plai','B2B'),('planbase','Healthcare'),('plane','B2B'),
  ('platzi','B2B'),('players-lounge','Consumer'),('playgent','Healthcare'),('plek-ai','B2B'),('plena-health','Healthcare'),('pleom','B2B'),
  ('plivo','B2B'),('ploid','B2B'),('plover-labs','B2B'),('ploy','B2B'),('plura','Consumer'),('plusidentity','B2B'),
  ('plutis','B2B'),('pocket','Consumer'),('pocket-worlds','Consumer'),('pocketsuite','B2B'),('podium','B2B'),('pointone','B2B'),
  ('poka-labs','B2B'),('polar','Fintech'),('polemos-industries','Industrials'),('policyfly','Fintech'),('poll-everywhere','B2B'),('pollen','B2B'),
  ('poly','Consumer'),('polymath','B2B'),('polymath-robotics','Industrials'),('polymorph','B2B'),('polytomic','B2B'),('pomerado','B2B'),
  ('pools-fka-withfriends','Consumer'),('popl','B2B'),('poplarml','B2B'),('portalform','B2B'),('porter','B2B'),('posh','Industrials'),
  ('positive','Consumer'),('postal','Fintech'),('postera','Healthcare'),('posthog','B2B'),('postlet','B2B'),('posturehealth-inc','Healthcare'),
  ('poth-labs','B2B'),('potion','B2B'),('powder','Fintech'),('powerrouter','B2B'),('prana-health','Healthcare'),('praxim','B2B'),
  ('praxis','B2B'),('praxis-robotics','Industrials'),('precious','Consumer'),('precip','Consumer'),('prelim','Fintech'),('preload','B2B'),
  ('prenda','Education'),('prequel','B2B'),('prescience-inc','Healthcare'),('preseen','B2B'),('presto','B2B'),('prime-lightworks','Industrials'),
  ('primitive','B2B'),('primordiant','Industrials'),('prism','B2B'),('prized','B2B'),('probably-genetic','Healthcare'),('probe','B2B'),
  ('probo','B2B'),('proception-inc','Industrials'),('procindex','B2B'),('prodigal','Fintech'),('prodigy-research','Fintech'),('prohostai','B2B'),
  ('proliferate','B2B'),('promakhos-therapeutics','Healthcare'),('prometheus','Industrials'),('promi','B2B'),('promise','Government'),('promptarmor','B2B'),
  ('promptless','B2B'),('promptloop','B2B'),('proof-of-human','B2B'),('proof-trading','Fintech'),('propaya','Real Estate and Construction'),('propelauth','B2B'),
  ('propexo','B2B'),('proprio-robotics','Industrials'),('proprise','Real Estate and Construction'),('prosights','B2B'),('prosper','B2B'),('proto','B2B'),
  ('protocol-labs','B2B'),('proven-group','Consumer'),('provenmetal','Industrials'),('prox','Industrials'),('proximitty','Fintech'),('proxis','B2B'),
  ('pulley','B2B'),('pulse-3','B2B'),('pump-co','Fintech'),('pumpgtm','B2B'),('punchcard','B2B'),('pure','Consumer'),
  ('pushbullet','Consumer'),('pyka','Industrials'),('pylon-2','B2B'),('pyrls','Healthcare'),('pyxai','B2B'),('qfex','Fintech'),
  ('qlo','Fintech'),('quadrant-health','Healthcare'),('qualgent','B2B'),('quantierra','Real Estate and Construction'),('quantstamp','B2B'),('quantstruct','B2B'),
  ('quartzy','Healthcare'),('query-vary','B2B'),('quetzal','B2B'),('quicknode','B2B'),('quill','B2B'),('quill-bills','Healthcare'),
  ('quilt-data','B2B'),('quindar','B2B'),('quinn','Healthcare'),('quippy','Consumer'),('quivly-ai','B2B'),('quotain','B2B'),
  ('quotient-labs','B2B'),('qventus','Healthcare'),('qvin','Healthcare'),('rabbet','Real Estate and Construction'),('radar','B2B'),('radical','Industrials'),
  ('radiusbrowser','B2B'),('radley','Healthcare'),('rainbow','Fintech'),('rainbrand','B2B'),('raindrop','B2B'),('rainforest','B2B'),
  ('rallyuxr','B2B'),('ralo','Fintech'),('ramain','B2B'),('ramen-vr','Consumer'),('random-labs','B2B'),('rankai','B2B'),
  ('rankscience','B2B'),('rapidfolio','B2B'),('raptor-maps','Industrials'),('rarebird','Healthcare'),('rasyn','Healthcare'),('rational','B2B'),
  ('ravion','B2B'),('ravn','Government'),('raycaster','Healthcare'),('rct-studio','Consumer'),('reach','Industrials'),('reacher','B2B'),
  ('read-bean','Consumer'),('readily','Healthcare'),('readme','B2B'),('ready','Government'),('reality-defender','B2B'),('realpact','Real Estate and Construction'),
  ('realroots','Consumer'),('reason-machines','B2B'),('reasonblocks','B2B'),('rebellyous-foods','Healthcare'),('rebolt','B2B'),('rebulk','B2B'),
  ('recall-ai','B2B'),('recidiviz','Government'),('recipeui','B2B'),('reconero','Government'),('recover','Healthcare'),('recurrency','B2B'),
  ('recurse-center','Education'),('red-barn-robotics','Industrials'),('redbird','B2B'),('redbrick-ai','B2B'),('reditus-space','Industrials'),('redouble-ai','B2B'),
  ('redoubt-insurance','Fintech'),('reducto','B2B'),('refactor','B2B'),('refine','B2B'),('refinetrain-ai','B2B'),('reflex','B2B'),
  ('reform','B2B'),('reframe','Healthcare'),('refresh','B2B'),('regbase','B2B'),('regent','Industrials'),('reific','B2B'),
  ('rejoy-health','Healthcare'),('rejuvenation-technologies-inc','Healthcare'),('rekursivai','B2B'),('relace','B2B'),('relari','Industrials'),('relationship-hero','Consumer'),
  ('relativity-space','Industrials'),('relaw','B2B'),('relay-health','Healthcare'),('release','B2B'),('relling','B2B'),('relvy-ai','B2B'),
  ('remi','Real Estate and Construction'),('remix-3','Consumer'),('remora','Industrials'),('remy-ai','Industrials'),('render','B2B'),('renderlet','B2B'),
  ('rentahuman','Consumer'),('rentflow','B2B'),('renthop','Real Estate and Construction'),('repaint','B2B'),('replicas','B2B'),('replika','Consumer'),
  ('replit','B2B'),('replo','B2B'),('repool','Fintech'),('repovive','B2B'),('reprompt','B2B'),('rescale','B2B'),
  ('rescript','B2B'),('rescuetime','B2B'),('resin-technologies','B2B'),('resolve','Real Estate and Construction'),('respan','B2B'),('response','B2B'),
  ('resquared','B2B'),('retailready','B2B'),('retell-ai','B2B'),('rethoric','B2B'),('reticular','Healthcare'),('retool','B2B'),
  ('retrofit','Consumer'),('retrofix','B2B'),('rev-genomics','Healthcare'),('rev1','B2B'),('revamp','B2B'),('revenuecat','B2B'),
  ('revion','B2B'),('revise-robotics','Industrials'),('reviving-mind','Healthcare'),('revl','B2B'),('revoy','Industrials'),('revyl','B2B'),
  ('rewbi','Industrials'),('reworkd','B2B'),('rex-fit','Consumer'),('rex-inc','B2B'),('rezi','Real Estate and Construction'),('rezora-io','B2B'),
  ('rhem-labs','Healthcare'),('rhizome-ai','B2B'),('ridecell','B2B'),('riften','B2B'),('rigetti-computing','Industrials'),('rightnow','B2B'),
  ('rima-ai','B2B'),('rimba','Industrials'),('rindler','B2B'),('ringmd','Government'),('rinse','Healthcare'),('rinsed','B2B'),
  ('rippling','B2B'),('rise-reforming','Industrials'),('risely-ai','Education'),('riskcube','Fintech'),('risklytics','Fintech'),('risotto','B2B'),
  ('river-markets','Fintech'),('riverbank','B2B'),('rivereditor','B2B'),('rivet','B2B'),('rivet-design','B2B'),('riveter','B2B'),
  ('riviera','B2B'),('rmfg','Industrials'),('roame','Consumer'),('roark','B2B'),('robby','B2B'),('robocurve','Industrials'),
  ('robodock','Industrials'),('roboflow','B2B'),('rocketable','B2B'),('rocketlit','Education'),('rodeo-robotics','Industrials'),('roe','B2B'),
  ('roger','B2B'),('rollstack-2','B2B'),('rome-ai','B2B'),('ronanrx-inc','Healthcare'),('roofr','Consumer'),('rook-space','Industrials'),
  ('rootly','B2B'),('rosebud-ai','Consumer'),('rosebud-biosciences','Healthcare'),('rote','B2B'),('roundabout-technologies','Government'),('routant','B2B'),
  ('rove','Consumer'),('rovi-health','Healthcare'),('rowflow','B2B'),('rownd','Industrials'),('rthm','Healthcare'),('rubbrband','Consumer'),
  ('rubric-ai','B2B'),('ruby-card','Fintech'),('rudus','Real Estate and Construction'),('rulebase','B2B'),('rulebricks','B2B'),('runanywhere','B2B'),
  ('rune','Consumer'),('runharbor','Healthcare'),('runrl','B2B'),('runtime','B2B'),('runtimesi','Industrials'),('rutter','B2B'),
  ('ryhla','Industrials'),('ryse','B2B'),('rystic','B2B'),('ryvn','B2B'),('s2-dev','B2B'),('saccade','Healthcare'),
  ('safebeat','Healthcare'),('safebutler','Fintech'),('safer-management','B2B'),('safetykit','B2B'),('safetywing','Fintech'),('saffron','B2B'),
  ('saga-ai','B2B'),('sagaland','Consumer'),('sage-ai','B2B'),('sagecare','Healthcare'),('sails-co','B2B'),('saldor','B2B'),
  ('salem-robotics-inc','Industrials'),('salesform','B2B'),('salespatriot','B2B'),('salient','B2B'),('salt-security','B2B'),('salus','B2B'),
  ('sameday','B2B'),('sante','B2B'),('saphira-ai','B2B'),('sapling-ai','B2B'),('saudara-ai','B2B'),('sava-trust-company','Fintech'),
  ('savant','B2B'),('sazabi','B2B'),('scale-ai','B2B'),('scanbase','Healthcare'),('scentbird','Consumer'),('scheduling-wizard','Healthcare'),
  ('sciloop','B2B'),('scoop','B2B'),('scope','B2B'),('scott-ai','B2B'),('scout-2','Healthcare'),('scout-4','Education'),
  ('screenleap-inc','B2B'),('screenpipe','B2B'),('scribd','Consumer'),('scritch','Healthcare'),('se3-labs','B2B'),('seam','B2B'),
  ('seer','B2B'),('segmed','Healthcare'),('segment','B2B'),('sei-ai','Fintech'),('selfin','Fintech'),('selia','Healthcare'),
  ('sellraze','Consumer'),('semble','B2B'),('semiotic','B2B'),('sendbird','B2B'),('sendblue','B2B'),('sennu-ai','B2B'),
  ('sensei','Industrials'),('sentient-os','B2B'),('sentiyen','B2B'),('sentrial','B2B'),('sequin','B2B'),('serafis','B2B'),
  ('serif-health','Healthcare'),('serinus-biosciences','Healthcare'),('serna-bio','Healthcare'),('sero','B2B'),('serra','B2B'),('serve-ai','B2B'),
  ('sf-tensor','B2B'),('sfa-therapeutics-inc','Healthcare'),('sfox','Fintech'),('shape-shapescale','Consumer'),('shaped','B2B'),('sharpe','B2B'),
  ('shasqi','Healthcare'),('shasta-health','Healthcare'),('shef','Consumer'),('shepherd','Fintech'),('shepherd-robotics','Industrials'),('sherpa','B2B'),
  ('sherpa-labs','B2B'),('shiboleth','B2B'),('shielded','B2B'),('shift-health','Healthcare'),('shimmer','Healthcare'),('shinkei-systems','Industrials'),
  ('shipbob','B2B'),('shiraz-ai','Industrials'),('shire-intelligence','B2B'),('shiru','Healthcare'),('shofo','B2B'),('shogun','B2B'),
  ('shoptiques','Consumer'),('shor','Fintech'),('short-story','Consumer'),('shortbread','Consumer'),('shotwellai','Industrials'),('shred-video','Consumer'),
  ('sid','B2B'),('sieve','B2B'),('sieveai','B2B'),('sift','B2B'),('siftly','B2B'),('sigma-genetics','Healthcare'),
  ('sigmamind-ai','B2B'),('sigmanticai','B2B'),('sigmaos','Consumer'),('signadot','B2B'),('signals','B2B'),('signoz','B2B'),
  ('silica','Industrials'),('silimate','B2B'),('silkchart','B2B'),('silmaril','B2B'),('silogy','B2B'),('silurian','Industrials'),
  ('sim','B2B'),('simbie-ai','Healthcare'),('simcare','Healthcare'),('simple-ai','B2B'),('simplex','B2B'),('simplify','Consumer'),
  ('simplyinsured','Healthcare'),('simulithic','B2B'),('sinai','Industrials'),('singlestore','B2B'),('singularity','Industrials'),('sinovia-technologies','Industrials'),
  ('sinter-systems','Industrials'),('sintropix','B2B'),('siphox-health','Healthcare'),('sira','B2B'),('sitenna','B2B'),('sixtyfour','B2B'),
  ('sizeless','Real Estate and Construction'),('skillsync','B2B'),('skyhook','B2B'),('skymerse','Industrials'),('skypher','B2B'),('skyscrape','Industrials'),
  ('skyvern','B2B'),('skyways','Industrials'),('slash','Fintech'),('slashy','B2B'),('sleep-reset','Healthcare'),('slope','Fintech'),
  ('smartasset','Fintech'),('smartcuts','B2B'),('smartpath','Fintech'),('smol-machines','B2B'),('snackpass','Consumer'),('snapcalorie','Consumer'),
  ('snapdocs','Real Estate and Construction'),('snapmagic','B2B'),('snappr','B2B'),('snowstone','B2B'),('socksoho','Consumer'),('soco','Consumer'),
  ('socratix-ai','B2B'),('sola','B2B'),('solidroad','B2B'),('solo','Fintech'),('solugen','Healthcare'),('solum-health','Healthcare'),
  ('solva','Fintech'),('somatic','Industrials'),('sona8','B2B'),('sonatoria','B2B'),('sonia','Healthcare'),('soon','Fintech'),
  ('sophys','Healthcare'),('soraban','B2B'),('sorce','B2B'),('sorcerer','Industrials'),('soren','B2B'),('soria','Fintech'),
  ('sorting-robotics','B2B'),('sota2','B2B'),('soteri-skin','Consumer'),('sourcebot','B2B'),('sourceress','B2B'),('sourcify','B2B'),
  ('spaceflow-technologies-inc','B2B'),('spacesheep','B2B'),('spade','Fintech'),('spate','B2B'),('speak','Consumer'),('speccheck','B2B'),
  ('specific-labs','B2B'),('spectre-intelligence','Fintech'),('speedscale','B2B'),('speko','B2B'),('spellbrush','Consumer'),('sphere','B2B'),
  ('spherecast','B2B'),('sphinx','Fintech'),('spice-data','B2B'),('spinach-ai','B2B'),('spine','B2B'),('spine-ai','B2B'),
  ('spire-law','B2B'),('splash-inc','Industrials'),('spline','B2B'),('spokn','B2B'),('sponge','B2B'),('spot-health','Healthcare'),
  ('spotangels','Consumer'),('spotless-materials','Industrials'),('spotlight-realty','Real Estate and Construction'),('spotpay','Fintech'),('spring-in-africa','Fintech'),('sprites','B2B'),
  ('spruceid','Government'),('spur','B2B'),('squire-technologies','Consumer'),('stable','B2B'),('stablebrowse','Industrials'),('stably-ai-orca','B2B'),
  ('stacksync','B2B'),('stacktrace','B2B'),('staffbar','B2B'),('stairs-financial','Fintech'),('stamp','B2B'),('standard-ai','B2B'),
  ('standard-gaussian','Fintech'),('standard-machines','B2B'),('standard-physics','Industrials'),('standard-signal','Fintech'),('standout','B2B'),('star','Consumer'),
  ('starcloud','Industrials'),('stardex','B2B'),('stardrift','Consumer'),('stark-bank','Fintech'),('starling','Healthcare'),('starsling','B2B'),
  ('startplaying-games','Consumer'),('stasis','Consumer'),('status','Consumer'),('stayflexi','B2B'),('stealth-worker','B2B'),('steinmetz','Industrials'),
  ('stellar-sleep','Healthcare'),('stellon-labs','B2B'),('stepful','Education'),('stewdio','Consumer'),('stoa','Fintech'),('stock-unlock','Fintech'),
  ('stockline','B2B'),('stoke-space','Industrials'),('stormy','B2B'),('storyboarder','Consumer'),('storylane','B2B'),('storyworth','Consumer'),
  ('strac','B2B'),('strada','B2B'),('strand-ai','Healthcare'),('streak','B2B'),('stream','Fintech'),('streamable','Consumer'),
  ('streamline-systems','Industrials'),('strideq','B2B'),('stripe','Fintech'),('strong-compute','B2B'),('struct-ai','B2B'),('structured-ai','Real Estate and Construction'),
  ('studdy','Education'),('studio','B2B'),('styleup','Consumer'),('subimage','B2B'),('submittable','B2B'),('substack','B2B'),
  ('substrate','B2B'),('subtrace','B2B'),('subvysion','Real Estate and Construction'),('sudocode','B2B'),('suiteness','Consumer'),('sully','B2B'),
  ('summer-engine','Consumer'),('sunflower','Healthcare'),('sunlight','Fintech'),('sunpia','B2B'),('sunsama','B2B'),('sunset','Fintech'),
  ('supabase','B2B'),('supadock','B2B'),('super-powers-mobility-spm','Industrials'),('superagent','B2B'),('supermedium','Consumer'),('superorder','B2B'),
  ('superserve','B2B'),('supertokens','B2B'),('superunit','B2B'),('sureform','B2B'),('suretynow','Fintech'),('surface-labs','B2B'),
  ('surge','B2B'),('surtr-defense-systems','Industrials'),('sutrix','Healthcare'),('svbtle','Consumer'),('svix','B2B'),('swadesh','Fintech'),
  ('swayable','B2B'),('sweep','B2B'),('sweetspot','B2B'),('swerve','Consumer'),('swif-ai','B2B'),('swiftsku','B2B'),
  ('sygaldry-technologies','Industrials'),('symphony','B2B'),('synapse-semiconductor','Industrials'),('synapticure','Healthcare'),('synara','B2B'),('sync-2','B2B'),
  ('syncly','B2B'),('synder','B2B'),('synkrino-biotherapeutics','Healthcare'),('synnax','B2B'),('synphony','Industrials'),('synsorybio','Healthcare'),
  ('synth-3','B2B'),('synthetic-sciences','B2B'),('synthetic-society','B2B'),('syntheticfi','Fintech'),('synthio-labs','Healthcare'),('syntra','Healthcare'),
  ('synvivia','Healthcare'),('t3-chat','Consumer'),('taanai','B2B'),('tableflow','B2B'),('tago-health','B2B'),('tagsafe','B2B'),
  ('taiga','Healthcare'),('talc','B2B'),('talentpluto','B2B'),('talkable','B2B'),('talking-computers','B2B'),('taloflow','B2B'),
  ('talos-us','Industrials'),('talus-bio','Healthcare'),('tamarind-bio','B2B'),('tamlabs','B2B'),('tandem-2','B2B'),('tank-payments','Fintech'),
  ('tappity','Consumer'),('tara-ai','B2B'),('tarebio','Healthcare'),('tarifflo-inc','B2B'),('tarjimly-acquired','Healthcare'),('tash','Consumer'),
  ('taskade','B2B'),('tasker-ai','B2B'),('tasklet-2','B2B'),('tavus','B2B'),('taxgpt','B2B'),('tdaycom','B2B'),
  ('teaflask','B2B'),('teamout','B2B'),('teclada','B2B'),('tegore','Education'),('telamont','Real Estate and Construction'),('teleport','B2B'),
  ('telmai','B2B'),('tempo','Healthcare'),('tennr','B2B'),('tenor','B2B'),('tensortest','B2B'),('tensr','Industrials'),
  ('tepali','B2B'),('tequitable','B2B'),('tergle','B2B'),('terminal-use','B2B'),('terra-api','B2B'),('terracotta-ai','B2B'),
  ('terraferma','Industrials'),('terrakotta','B2B'),('terranox-ai','Industrials'),('tesora','Fintech'),('tesorio','B2B'),('tesseract','Industrials'),
  ('testrigor','B2B'),('tetrascience','Healthcare'),('texel-ai','B2B'),('text-ai','Consumer'),('text-blaze','B2B'),('textsidekick','B2B'),
  ('the-agentic-data-co','B2B'),('the-ankler','Consumer'),('the-breakaway','Consumer'),('the-company-company','B2B'),('the-context-company','B2B'),('the-essential','Consumer'),
  ('the-flex-company','Consumer'),('the-good-food-institute','Consumer'),('the-hog','B2B'),('the-juggernaut','Consumer'),('the-new-money-company','Fintech'),('the-prompting-company','B2B'),
  ('the-subvocal-company','Consumer'),('the-synthesis-company','B2B'),('the-third-place','B2B'),('the-ticket-fairy','Consumer'),('the-token-company','B2B'),('thedailyscout','Consumer'),
  ('theo','B2B'),('theora','B2B'),('theorem-2','B2B'),('thera','B2B'),('therecraft','Industrials'),('theseus','Industrials'),
  ('theta','B2B'),('theya','Fintech'),('third-chair','B2B'),('thirdlayer','B2B'),('thornwick','Fintech'),('thrive-agritech','Industrials'),
  ('thunder-compute','B2B'),('thunkable','B2B'),('ticket-wallet','B2B'),('tilion','B2B'),('tilo','B2B'),('tinfoil','B2B'),
  ('tint','Fintech'),('tire-swing','B2B'),('tiriel-ai','B2B'),('titan','Fintech'),('titanio','B2B'),('token-transit','Government'),
  ('tokenless','B2B'),('toko','Education'),('tolemi','Real Estate and Construction'),('tolmo','B2B'),('toma','B2B'),('toothy-ai','Healthcare'),
  ('topkey','B2B'),('topline-pro','B2B'),('topological','B2B'),('topos','Industrials'),('torpedo-therapeutics','Healthcare'),('torus','Industrials'),
  ('totalis','Fintech'),('touchmark','B2B'),('tovala','Consumer'),('tovenai','Fintech'),('tracecat','B2B'),('traceforce','B2B'),
  ('tracer','B2B'),('traceroot','B2B'),('traces','B2B'),('trackstar','B2B'),('tractian','Industrials'),('tradeflow','Fintech'),
  ('tradewind-bioscience','Healthcare'),('tradex','Consumer'),('trainloop','B2B'),('trainy','B2B'),('transastra-corporation','Industrials'),('trapeze','Healthcare'),
  ('trata','B2B'),('trava','B2B'),('traverse','B2B'),('travo','Real Estate and Construction'),('trayd','B2B'),('treasury-prime','Fintech'),
  ('treblo','Consumer'),('trebu','B2B'),('trelium','B2B'),('trellis-ai','B2B'),('trellistech','B2B'),('trellus','B2B'),
  ('tremendous','Fintech'),('trendex-connect-with-stars','Consumer'),('trepo','Consumer'),('trestle-biotherapeutics','Healthcare'),('trident','B2B'),('trim','B2B'),
  ('triomics','Healthcare'),('trm-labs','B2B'),('trope','B2B'),('true-link','Fintech'),('true3d','B2B'),('truebiz','B2B'),
  ('trueclaim','Healthcare'),('truemile','B2B'),('truevault','B2B'),('truewind','B2B'),('truss','Fintech'),('trusty','Real Estate and Construction'),
  ('truthsystems','B2B'),('trycardinal-ai','B2B'),('tryjanet','B2B'),('trylatent','B2B'),('trynearby','B2B'),('tsenta','Consumer'),
  ('tuesday-labs','Consumer'),('tumult','B2B'),('tupelo','B2B'),('turing-labs-inc','B2B'),('turion-space','Industrials'),('turnstone','B2B'),
  ('tuva-health','Healthcare'),('tweeksio','B2B'),('twentyfour26','Industrials'),('twentytwo','Healthcare'),('twine','B2B'),('two-dots','Fintech'),
  ('twolabs','B2B'),('tybr-health','Healthcare'),('typa','B2B'),('type','Consumer'),('ubicloud','B2B'),('ukama','B2B'),
  ('ultra','Industrials'),('ultralight','B2B'),('ultrasonium','Industrials'),('unbound','B2B'),('uncommon-therapeutics','Healthcare'),('undermind','B2B'),
  ('understood-care','Healthcare'),('unifold','Fintech'),('unison','Consumer'),('unisson','B2B'),('units','Education'),('unlayer','B2B'),
  ('uno-wallet','Fintech'),('unsiloed-ai','B2B'),('unsloth-ai','B2B'),('unstatiq','B2B'),('untether-labs','Healthcare'),('unusual','B2B'),
  ('upcall','B2B'),('upchieve','Education'),('upcodes','Real Estate and Construction'),('upequity','Real Estate and Construction'),('upfort','B2B'),('upgraded','Consumer'),
  ('uplane','B2B'),('uplift-ai','B2B'),('upsolve','Fintech'),('upwave','B2B'),('useforward','Fintech'),('uselemma','B2B'),
  ('usenarrative','Consumer'),('useparrot','B2B'),('usereframe','B2B'),('userlens','B2B'),('useterse','B2B'),('usul','Government'),
  ('uxduck','Industrials'),('vaero','Consumer'),('valctrl','Fintech'),('valgo','B2B'),('valink-therapeutics','Healthcare'),('valo','Industrials'),
  ('valuemate','B2B'),('vanta','B2B'),('vantedgeai','Fintech'),('vapi','B2B'),('variance','B2B'),('variant','B2B'),
  ('varos','B2B'),('vassar-robotics','Consumer'),('vaya','Consumer'),('vector','B2B'),('vector-legal','B2B'),('vectorshift','B2B'),
  ('vedabio','Healthcare'),('veeza-ai','Consumer'),('vela','B2B'),('veles','B2B'),('vellum','B2B'),('velontra','Industrials'),
  ('velorum-therapeutics','Healthcare'),('velos','Fintech'),('velt','B2B'),('velum-labs','B2B'),('velvet','B2B'),('vena-vitals','Healthcare'),
  ('vendoo','Consumer'),('vendora','B2B'),('vendra','Industrials'),('venostent','Healthcare'),('ventura','Industrials'),('venu-ai','B2B'),
  ('vera-health','Healthcare'),('verata','B2B'),('verbiflow','B2B'),('verdant','Government'),('verdex','Fintech'),('verdun','B2B'),
  ('verge-genomics','Healthcare'),('vergesense','Real Estate and Construction'),('veria-labs','B2B'),('verifiable','Healthcare'),('veritus','Fintech'),('verne-robotics','Industrials'),
  ('vernius-systems-inc','Industrials'),('verno','Industrials'),('versa','B2B'),('versable','B2B'),('versine','Fintech'),('version-story-compare','B2B'),
  ('versive','B2B'),('veryfi-inc','B2B'),('vesence','B2B'),('vespin','B2B'),('vespper','B2B'),('vestris','Real Estate and Construction'),
  ('vetcove','B2B'),('vetrec','B2B'),('vexo','Consumer'),('vibe','B2B'),('vibe-robotics','Industrials'),('vibeflow','B2B'),
  ('vibrant-labs','B2B'),('videogen','B2B'),('videopixie','B2B'),('village-labs','B2B'),('vimcal','B2B'),('vimmerse','B2B'),
  ('vinci-games','Consumer'),('virtualmin','B2B'),('visibl-semiconductors','B2B'),('vista-power','Industrials'),('vitable-health','Healthcare'),('vitalize','Healthcare'),
  ('vly-ai-2','B2B'),('vocality-health','Healthcare'),('voiceops','B2B'),('voiceos','Consumer'),('void','B2B'),('voker','B2B'),
  ('volantio','B2B'),('volaren','Fintech'),('volta-labs-inc','Healthcare'),('voltair','Industrials'),('voltic','Industrials'),('vooma','B2B'),
  ('voquill','Healthcare'),('vorelios','Industrials'),('vorflux','B2B'),('vori','B2B'),('vortexify','B2B'),('vorticity','Industrials'),
  ('vote-org','Consumer'),('votingworks','Government'),('vouch','Fintech'),('voyager','B2B'),('voygr','B2B'),('vulcan-technologies','B2B'),
  ('vybe','B2B'),('vyra','Consumer'),('waddle-labs','Industrials'),('wafer','B2B'),('wakeshift','B2B'),('wakie','Consumer'),
  ('walter','B2B'),('wanderlog','Consumer'),('wantd','Consumer'),('wardstone','Industrials'),('warp','B2B'),('warpbuild','B2B'),
  ('wasmer','B2B'),('waterplan','B2B'),('wato','B2B'),('watsi','Healthcare'),('wavedash','Consumer'),('wavelength','B2B'),
  ('wayco','B2B'),('wayline','Real Estate and Construction'),('waypoint','B2B'),('weathercheck','Fintech'),('weave-3','B2B'),('weave-robotics','Industrials'),
  ('webflow','B2B'),('webhound','Consumer'),('wedge','Healthcare'),('weekend-fmr-volley','Consumer'),('wefunder','Fintech'),('well-principled','B2B'),
  ('westgate','Industrials'),('wevorce','Consumer'),('whalesync','B2B'),('whatnot','Consumer'),('whip','Consumer'),('whitespace','B2B'),
  ('wideframe','B2B'),('wild-moose','B2B'),('willow','Consumer'),('windwalk','Consumer'),('winfunc','B2B'),('wingman-law','B2B'),
  ('withasync','B2B'),('withcharm','Consumer'),('within','B2B'),('wolfia','B2B'),('wondering','Consumer'),('wonderly','B2B'),
  ('wondertx','Healthcare'),('wordware','Consumer'),('workers-io','B2B'),('workflow86','B2B'),('workflowy','B2B'),('worklytics','B2B'),
  ('woz','B2B'),('wren','Industrials'),('wright-electric','Industrials'),('x3-builders','Real Estate and Construction'),('xgenomes','Healthcare'),('xtraffic','Government'),
  ('xulux','B2B'),('yam','Consumer'),('yardbook','B2B'),('yarn-2','B2B'),('yearend','Fintech'),('yn','Consumer'),
  ('yondu','Industrials'),('yoneda-labs','B2B'),('yoshi-mobility','Consumer'),('yotta','Fintech'),('youart','B2B'),('youlearn','Education'),
  ('yourchoice-therapeutics','Healthcare'),('youshift','B2B'),('yuma-ai','B2B'),('yummy-future','Industrials'),('yummy-inc','Consumer'),('zapier','B2B'),
  ('zarna','B2B'),('zatanna','B2B'),('zaymo','B2B'),('zbiotics','Healthcare'),('zeal','Fintech'),('zeitview','Industrials'),
  ('zelos-cloud','B2B'),('zendar','Industrials'),('zenflow','Healthcare'),('zensors-inc','B2B'),('zentail','B2B'),('zenysis','Government'),
  ('zeo-route-planner','B2B'),('zeon-systems','Industrials'),('zep-ai','B2B'),('zephyr-fusion','Industrials'),('zeplin','B2B'),('zerocater','B2B'),
  ('zerodev','B2B'),('zeropath','B2B'),('zerosettle','B2B'),('zeta-surgical','Healthcare'),('zettascale-computing','Industrials'),('zibra-labs','B2B'),
  ('zidisha','Fintech'),('zinc','B2B'),('zip','B2B'),('zoa-research','B2B'),('zolvo','Fintech'),('zomma','B2B'),
  ('zorba','Real Estate and Construction'),('zuddl','B2B'),('zudo','B2B')
  ) as v(slug, industry)
 where c.is_catalog and c.slug = v.slug
   and (c.batch is not null or coalesce(c.source, '') ilike 'y combinator%')
   and c.industry is distinct from v.industry;

create index if not exists companies_catalog_industry_idx on public.companies (public.fr_slugify(industry)) where is_catalog;

-- ---------------------------------------------------------------- public read
create or replace function public.fr_catalog_row(c public.companies) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', public.fr_strip_emails(c.name),
    'batch', c.batch,
    'batch_year', c.batch_year,
    'description', left(btrim(regexp_replace(public.fr_strip_emails(coalesce(c.description, '')), '\s+', ' ', 'g')), 320),
    'industry', nullif(btrim(coalesce(c.industry, '')), ''),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'hiring', public.fr_safe_url(c.careers_url) is not null,
    'leaders', (select count(*) from public.contacts k where k.company_id = c.id)
  )
$$;

-- p_sector matches the industry slug or the (finer) sector slug, so older /sector links keep working.
create or replace function public.catalog_list(
  p_q text default null,
  p_sector text default null,
  p_city text default null,
  p_batch text default null,
  p_year integer default null,
  p_hiring boolean default false,
  p_page integer default 1,
  p_per integer default 30
) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select c.id, c.batch_year, c.batch, c.name, c.slug
      from public.companies c
     where c.is_catalog and c.slug is not null
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or c.name ilike '%' || public.fr_like(btrim(p_q)) || '%'
            or c.description ilike '%' || public.fr_like(btrim(p_q)) || '%')
       and (nullif(public.fr_slugify(p_sector), '') is null
            or public.fr_slugify(c.industry) = public.fr_slugify(p_sector)
            or public.fr_slugify(c.sector) = public.fr_slugify(p_sector))
       and (nullif(public.fr_slugify(p_city), '') is null or public.fr_slugify(c.location) = public.fr_slugify(p_city))
       and (nullif(btrim(coalesce(p_batch, '')), '') is null or upper(c.batch) = upper(btrim(p_batch)))
       and (p_year is null or c.batch_year = p_year)
       and (not coalesce(p_hiring, false) or public.fr_safe_url(c.careers_url) is not null)
  ), page as (
    -- Companies without a batch come after every batched company.
    select f.id,
           row_number() over (order by (f.batch is null), f.batch_year desc nulls last, public.fr_season_rank(f.batch) desc, lower(f.name), f.slug) as rn
      from f
     order by rn
     limit least(greatest(coalesce(p_per, 30), 1), 100)
    offset (least(greatest(coalesce(p_page, 1), 1), 100000) - 1) * least(greatest(coalesce(p_per, 30), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(public.fr_catalog_row(c) order by p.rn)
                        from page p join public.companies c on c.id = p.id), '[]'::jsonb)
  )
$$;

-- Options are merged by slug (the same key catalog_list filters on), shown under their most common spelling.
create or replace function public.catalog_facets() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select nullif(btrim(coalesce(industry, '')), '') as industry,
           nullif(btrim(coalesce(sector, '')), '') as sector,
           nullif(btrim(coalesce(location, '')), '') as city,
           batch, batch_year
      from public.companies
     where is_catalog and slug is not null
  ), named as (
    select kind, public.fr_slugify(v) as key, (array_agg(v order by n desc, v))[1] as v, sum(n)::bigint as n
      from (
        select 'industries' as kind, industry as v, count(*) as n from c where public.fr_slugify(industry) <> '' group by industry
        union all
        select 'sectors', sector, count(*) from c where public.fr_slugify(sector) <> '' group by sector
        union all
        select 'cities', city, count(*) from c where public.fr_slugify(city) <> '' group by city
      ) s
     group by kind, public.fr_slugify(v)
  ), merged as (
    -- The sector filter matches a slug against industry or sector, so the count shown must do the same.
    select m.kind, m.v,
           case when m.kind = 'cities' then m.n
                else (select count(*) from c where public.fr_slugify(c.industry) = m.key or public.fr_slugify(c.sector) = m.key) end as n
      from named m
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'industries', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'industries'), '[]'::jsonb),
    'sectors', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'sectors'), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'cities'), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by y desc nulls last, public.fr_season_rank(v) desc)
                           from (select batch as v, max(batch_year) as y, count(*) as n from c where batch is not null group by batch) s), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v desc)
                         from (select batch_year as v, count(*) as n from c where batch_year is not null group by batch_year) s), '[]'::jsonb)
  )
$$;

create or replace function public.catalog_company(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', public.fr_strip_emails(c.name),
    'batch', c.batch,
    'batch_year', c.batch_year,
    'yc', coalesce(c.source, '') ilike 'y combinator%' or c.batch is not null,
    'name_shared', exists (select 1 from public.companies o
                            where o.is_catalog and o.id <> c.id and lower(o.name) = lower(c.name) and o.batch is not distinct from c.batch),
    'description', btrim(public.fr_strip_emails(coalesce(c.description, ''))),
    'industry', nullif(btrim(coalesce(c.industry, '')), ''),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'website', public.fr_safe_url(c.website),
    'careers_url', public.fr_safe_url(c.careers_url),
    'contact_url', public.fr_contact_url(c.contact_url),
    'linkedin_url', public.fr_safe_linkedin(c.linkedin_url),
    'updated_at', greatest(c.updated_at, c.created_at),
    'leaders', coalesce((
      select jsonb_agg(l.j order by l.tier, l.chief desc, l.created_at, l.id)
        from (
          select jsonb_build_object(
                   'id', k.id,
                   'first_name', btrim(public.fr_strip_emails(coalesce(k.first_name, ''))),
                   'last_name', btrim(public.fr_strip_emails(coalesce(k.last_name, ''))),
                   'role', nullif(btrim(public.fr_strip_emails(coalesce(k.role, ''))), ''),
                   'tier', case when k.role_category = 'Secondary' then 'Secondary' else 'Primary' end,
                   'linkedin_url', public.fr_safe_linkedin(k.linkedin_url)
                 ) as j,
                 case when k.role_category = 'Secondary' then 1 else 0 end as tier,
                 (coalesce(k.role, '') ~* '\m(ceo|chief executive)\M') as chief,
                 k.created_at, k.id
            from public.contacts k
           where k.company_id = c.id
           order by 2, 3 desc, k.created_at, k.id
           limit 40
        ) l
    ), '[]'::jsonb)
  )
    from public.companies c
   where c.is_catalog and c.slug = lower(btrim(coalesce(p_slug, '')))
   limit 1
$$;

-- Up to 30 companies first seen in the last 7 days; if there are none, the 30 most recent. Plus the latest refresh run.
create or replace function public.catalog_new() returns jsonb
language sql stable security definer set search_path = public as $$
  with recent as (
    select c.id
      from public.companies c
     where c.is_catalog and c.slug is not null and c.first_seen_at >= now() - interval '7 days'
     order by c.first_seen_at desc, lower(c.name)
     limit 30
  ), fallback as (
    select c.id
      from public.companies c
     where c.is_catalog and c.slug is not null and not exists (select 1 from recent)
     order by (c.batch is null), c.batch_year desc nulls last, public.fr_season_rank(c.batch) desc, c.first_seen_at desc nulls last, lower(c.name)
     limit 30
  ), pick as (
    select id from recent union all select id from fallback
  )
  select jsonb_build_object(
    'fresh', exists (select 1 from recent),
    'rows', coalesce((select jsonb_agg(public.fr_catalog_row(c) || jsonb_build_object('first_seen_at', c.first_seen_at)
                                       order by (exists (select 1 from recent)) desc, case when exists (select 1 from recent) then c.first_seen_at end desc nulls last,
                                                (c.batch is null), c.batch_year desc nulls last, public.fr_season_rank(c.batch) desc, lower(c.name))
                        from pick p join public.companies c on c.id = p.id), '[]'::jsonb),
    'run', (select jsonb_build_object('ran_at', r.ran_at, 'our_count', r.our_count, 'yc_count', r.yc_count, 'added', r.added)
              from public.refresh_runs r order by r.ran_at desc, r.id desc limit 1)
  )
$$;

-- ---------------------------------------------------------------- ingest: also stores industry, applies the link rules
create or replace function public.ingest_companies(p_secret text, p_rows jsonb, p_yc_total integer, p_tracked integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  r jsonb;
  f jsonb;
  v_slug text;
  v_id uuid;
  v_pri integer;
  v_added integer := 0;
  v_skipped integer := 0;
  v_people integer := 0;
  v_our integer;
begin
  if not public.fr_cron_ok(p_secret) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select owner_id into v_owner from public.companies where is_catalog group by owner_id order by count(*) desc limit 1;
  if v_owner is null then
    raise exception 'The catalog has no owner yet.';
  end if;

  if jsonb_typeof(p_rows) = 'array' then
    for r in select value from jsonb_array_elements(p_rows) limit 100 loop
      v_slug := lower(btrim(coalesce(r->>'slug', '')));
      if v_slug !~ '^[a-z0-9][a-z0-9_-]{0,99}$' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if coalesce(r->>'skip', '') = 'true' then
        insert into public.suppressed_slugs (slug, reason)
        values (v_slug, left(coalesce(r->>'reason', 'skipped'), 80))
        on conflict (slug) do nothing;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if nullif(btrim(coalesce(r->>'name', '')), '') is null
         or exists (select 1 from public.companies where is_catalog and slug = v_slug)
         or exists (select 1 from public.suppressed_slugs where slug = v_slug) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_pri := case when coalesce(r->>'priority', '') ~ '^[1-5]$' then (r->>'priority')::integer else 3 end;

      insert into public.companies (owner_id, name, website, country, industry, sector, description, careers_url, contact_url, linkedin_url,
                                    priority, notes, logo_url, location, source, is_catalog, slug, batch, batch_year, first_seen_at)
      values (
        v_owner,
        left(btrim(r->>'name'), 200),
        public.fr_safe_url(left(r->>'website', 500)),
        'United States',
        nullif(left(btrim(coalesce(r->>'industry', '')), 80), ''),
        nullif(left(btrim(coalesce(r->>'sector', '')), 120), ''),
        nullif(left(btrim(public.fr_strip_emails(coalesce(r->>'description', ''))), 700), ''),
        public.fr_safe_url(left(r->>'careers_url', 500)),
        public.fr_contact_url(left(r->>'contact_url', 500)),
        public.fr_safe_linkedin(left(r->>'linkedin_url', 500)),
        v_pri,
        nullif(left(btrim(coalesce(r->>'notes', '')), 500), ''),
        public.fr_safe_url(left(r->>'logo_url', 500)),
        nullif(left(btrim(coalesce(r->>'location', '')), 120), ''),
        'Y Combinator',
        true,
        v_slug,
        case when coalesce(r->>'batch', '') ~ '^[WXSF][0-9]{2}$' then r->>'batch' end,
        case when coalesce(r->>'batch_year', '') ~ '^(19|20)[0-9]{2}$' then (r->>'batch_year')::integer end,
        now()
      )
      returning id into v_id;
      v_added := v_added + 1;

      if jsonb_typeof(r->'founders') = 'array' then
        for f in select value from jsonb_array_elements(r->'founders') limit 12 loop
          continue when nullif(btrim(coalesce(f->>'first_name', '')), '') is null;
          insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, priority, quality_score)
          values (
            v_owner,
            v_id,
            left(btrim(f->>'first_name'), 80),
            nullif(left(btrim(coalesce(f->>'last_name', '')), 120), ''),
            coalesce(nullif(left(btrim(coalesce(f->>'role', '')), 160), ''), 'Founder'),
            case when f->>'role_category' = 'Secondary' then 'Secondary' else 'Primary' end,
            public.fr_safe_url(left(f->>'linkedin_url', 500)),
            v_pri,
            least(100, 10 + 15
              + case when nullif(btrim(coalesce(f->>'last_name', '')), '') is not null then 5 else 0 end
              + case when public.fr_safe_url(f->>'linkedin_url') is not null then 20 else 0 end
              + case when public.fr_safe_url(r->>'website') is not null then 10 else 0 end
              + case when nullif(btrim(coalesce(r->>'description', '')), '') is not null then 10 else 0 end)
          );
          v_people := v_people + 1;
        end loop;
      end if;
    end loop;
  end if;

  select count(*) into v_our from public.companies where is_catalog and slug is not null;
  insert into public.refresh_runs (our_count, yc_count, added)
  values (case when p_tracked is null then v_our else least(p_tracked + v_added, p_yc_total) end, p_yc_total, v_added);
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'contacts', v_people, 'catalog_count', v_our, 'yc_count', p_yc_total);
end $$;

-- ---------------------------------------------------------------- grants (unchanged signatures; restated so the file stands alone)
revoke execute on function public.fr_catalog_row(public.companies) from public, anon, authenticated;
grant execute on function public.catalog_list(text, text, text, text, integer, boolean, integer, integer) to anon, authenticated;
grant execute on function public.catalog_facets() to anon, authenticated;
grant execute on function public.catalog_company(text) to anon, authenticated;
grant execute on function public.catalog_new() to anon, authenticated;
grant execute on function public.ingest_companies(text, jsonb, integer, integer) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
