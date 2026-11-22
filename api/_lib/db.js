// Calls a Postgres function through Supabase's REST API with the publishable (anon) key.
// There is no service-role key: everything the server may do is a `security definer` SQL function.
export class RpcError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
export async function rpc(name, args = {}, { timeout = 8000 } = {}) {
  const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (!url || !key) throw new RpcError('Database connection is not configured', 0, 'config');
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await r.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new RpcError(data?.message || `Database call ${name} failed`, r.status, data?.code || '');
  return data;
}
