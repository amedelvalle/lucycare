/**
 * Cliente Supabase con `service_role` para scripts admin.
 *
 * NUNCA importar esto desde código de frontend. Vive solo en
 * /scripts/ que no se incluye en el bundle Vite.
 *
 * El key se lee de SUPABASE_SERVICE_ROLE_KEY (env var). Si falta,
 * el script termina con error claro.
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.mjs';

const url = requireEnv('SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const SUPABASE_URL = url;
