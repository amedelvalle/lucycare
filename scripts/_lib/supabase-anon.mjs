/**
 * Cliente Supabase con anon key — para scripts que prueban como
 * usuario no autenticado.
 *
 * La anon key NO es secreto (se expone al frontend por diseño),
 * pero la movemos a env para no tener strings sueltos en scripts.
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.mjs';

const url = requireEnv('SUPABASE_URL');
const anonKey = requireEnv('SUPABASE_ANON_KEY');

export const supabaseAnon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;
