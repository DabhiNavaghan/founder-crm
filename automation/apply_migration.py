#!/usr/bin/env python3
"""Apply one reviewed migration file to the FoundReach database.

    python3 apply_migration.py NAME.sql < file          apply (the SQL is read from standard input)
    python3 apply_migration.py NAME.sql --check < file  only run the safety check

The file is sent to the run_migration() database function, which applies it once, in one
transaction. Settings, from the environment: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY,
MIGRATE_SECRET. Standard library only.

Exit status: 0 applied or already applied, 2 not configured, 3 held by the safety check
(the reason is printed), 1 anything else. The secret is never printed.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

# Statements a nightly, unattended run never executes. A migration that needs one waits for a person.
HOLD = [
    (r'\bdrop\s+(table|schema|database|type|extension|role|user)\b', 'drops a table, schema, type, extension or role'),
    (r'\bdrop\s+column\b', 'drops a column'),
    (r'\btruncate\b', 'truncates a table'),
    (r'\bdelete\s+from\b', 'deletes rows'),
    (r'\bdisable\s+row\s+level\s+security\b', 'turns row level security off'),
    (r'\b(app_secrets|applied_migrations|run_migration)\b', 'touches the pipeline\'s own secrets or migration records'),
    (r'\b(create|alter)\s+(role|user)\b', 'creates or changes a database role'),
    (r'\bcreate\s+extension\b', 'adds a database extension'),
    (r'\bservice_role\b', 'grants something to the service role'),
    (r'\bauth\.(users|identities|sessions)\b', 'touches the sign-in tables'),
    (r'\bcopy\b[^;]*\b(program|from|to)\b', 'reads or writes server files'),
    (r'\b(pg_read_file|pg_write_file|lo_import|lo_export|dblink|pg_net|http_(get|post))\b', 'reaches outside the database'),
]


def strip_comments(sql):
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return re.sub(r'--[^\n]*', ' ', sql)


def held(sql):
    text = strip_comments(sql).lower()
    return [why for pattern, why in HOLD if re.search(pattern, text)]


def without_transaction_lines(sql):
    """run_migration() is one transaction already, and a function cannot run begin or commit."""
    return re.sub(r'(?im)^[ \t]*(begin|commit)[ \t]*;[ \t]*$', '', sql)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check_only = '--check' in sys.argv
    if len(args) != 1 or not re.fullmatch(r'[0-9]{12}_[a-z0-9_]{1,80}\.sql', args[0]):
        print('apply_migration: the name must look like 202611250001_what_it_does.sql'); return 1
    name, sql = args[0], sys.stdin.read()
    reasons = held(sql)
    if reasons:
        print('held: ' + '; '.join(reasons)); return 3
    if check_only:
        print('check passed'); return 0
    url, key, secret = (os.environ.get(k, '').strip() for k in ('VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'MIGRATE_SECRET'))
    if not (url and key and secret):
        print('not configured: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and MIGRATE_SECRET are needed'); return 2
    body = json.dumps({'p_secret': secret, 'p_name': name, 'p_sql': without_transaction_lines(sql)}).encode()
    req = urllib.request.Request(url.rstrip('/') + '/rest/v1/rpc/run_migration', data=body, method='POST', headers={
        'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            out = json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:400].replace(secret, '***'); e.close()
        if e.code == 404 or 'PGRST202' in detail:
            print('not configured: the run_migration function is not in the database'); return 2
        if e.code in (401, 403) or 'Unauthorized' in detail:
            print('not configured: the database does not accept this server\'s migration secret'); return 2
        print('failed: HTTP %d %s' % (e.code, detail)); return 1
    except Exception as e:
        print('failed: %s' % str(e).replace(secret, '***')[:300]); return 1
    print('already applied' if out.get('already') else 'applied'); return 0


if __name__ == '__main__':
    sys.exit(main())
