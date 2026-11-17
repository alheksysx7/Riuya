import {createClient} from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = {'Cache-Control': 'no-store'};
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('CONFIG_UNAVAILABLE');
    const client = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
    const result = await client.schema('api').rpc('health_schema_compatible').abortSignal(AbortSignal.timeout(3000));
    if (result.error || result.data !== true) throw new Error('NOT_READY');
    return Response.json({status: 'ready'}, {headers});
  } catch {
    return Response.json({status: 'unavailable'}, {status: 503, headers});
  }
}
