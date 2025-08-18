import { createClient } from '@supabase/supabase-js';

// Browser/client: anon key (public)
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server/API: service role (do not import in client files)
export const supabaseServer = () =>
  createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, // fallback for now
    process.env.SUPABASE_SERVICE_ROLE!, // server-only
    { auth: { persistSession: false } }
  );