import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY; // support either name

if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
if (!anon) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');

export function supabaseBrowser() {
  return createClient(url, anon); // safe for the browser
}

export function supabaseServer() {
  if (!service) throw new Error('SUPABASE_SERVICE_ROLE (or SUPABASE_SERVICE_ROLE_KEY) is required');
  return createClient(url, service); // server-only, bypasses RLS
}