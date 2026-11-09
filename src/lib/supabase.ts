import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabase() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Falta configurar Supabase local');
  return createServerClient(url, key, { cookies: {
    getAll: () => jar.getAll(),
    setAll: (items) => { try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server Components no pueden modificar cookies. */ } },
  }});
}
