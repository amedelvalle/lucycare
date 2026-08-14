#!/usr/bin/env node
/**
 * check-s7_72 — RATING-URL-P0 · URL corta de calificación.
 *
 * Verificación ESTÁTICA del texto de la migración. NO toca la base: no abre
 * conexión, no lee el catálogo, no aplica nada. Su función es impedir que el
 * alcance se amplíe por accidente entre la revisión y la aplicación.
 *
 * La verificación EMPÍRICA del generador vive en dos lugares:
 *   · el bloque POST de la propia migración (100 generaciones, bloqueante);
 *   · `docs/OWNER_S7_72_SMOKE.md` (10 000 generaciones, lo corre el owner).
 * No puede vivir acá: el helper queda REVOCADO para `service_role`, que es
 * justamente lo que `_smoke-s7_72.mjs` comprueba.
 *
 *   node scripts/check-s7_72.mjs
 */
import fs from 'node:fs';

const FILE = 'migrations/s7_72_review_token_short_code.sql';
let pass = 0, fail = 0;

function check(nombre, valor, esperado = true) {
  const ok = valor === esperado;
  console.log(`  ${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` → ${JSON.stringify(valor)} (esperado ${JSON.stringify(esperado)})`}`);
  ok ? pass++ : fail++;
}

console.log('\ncheck-s7_72 — URL corta de calificación (estático)\n');

if (!fs.existsSync(FILE)) {
  console.error(`❌ no existe ${FILE}`);
  process.exit(1);
}
const sql = fs.readFileSync(FILE, 'utf8');

/**
 * SQL sin comentarios de línea. Las aserciones NEGATIVAS ("no usa X") deben
 * mirar el código EJECUTABLE: la migración nombra `random()` y
 * `gen_random_bytes()` en su encabezado justamente para documentar que NO los
 * usa, y escanear el archivo entero daba un falso positivo.
 */
const code = sql.replace(/--.*$/gm, '');

// ─── 1. Alcance: lo que la migración NO debe hacer ──────────────────
console.log('  — alcance —');
check('NO altera la tabla review_tokens', /ALTER\s+TABLE\s+(public\.)?review_tokens/i.test(sql), false);
check('NO crea ni borra índices', /\b(CREATE|DROP)\s+(UNIQUE\s+)?INDEX\b/i.test(sql), false);
check('NO redefine submit_review', /(CREATE|REPLACE)\s+FUNCTION\s+(public\.)?submit_review/i.test(sql), false);
check('NO redefine get_review_link', /(CREATE|REPLACE)\s+FUNCTION\s+(public\.)?get_review_link/i.test(sql), false);
check('NO recrea el trigger', /\b(DROP|CREATE)\s+TRIGGER\b/i.test(sql), false);
check('NO hace backfill (sin UPDATE sobre review_tokens)',
  /UPDATE\s+(public\.)?review_tokens/i.test(sql), false);
check('NO borra filas', /\bDELETE\s+FROM\b/i.test(sql), false);
check('NO otorga grants nuevos', /\bGRANT\b/i.test(sql), false);
check('NO toca auth.users ni auth.*', /\bauth\./i.test(sql), false);

// ─── 2. Generador: fuente y uniformidad ────────────────────────────
console.log('  — generador —');
check('usa gen_random_uuid()', /gen_random_uuid\(\)/.test(sql));
check('NO usa random()', /(?<!gen_)\brandom\s*\(\)/.test(code), false);
check('NO usa gen_random_bytes() (pgcrypto no habilitada)', /gen_random_bytes/.test(code), false);
check('descarta los bytes 6 y 8 del UUID', /CONTINUE\s+WHEN\s+v_i\s*=\s*6\s+OR\s+v_i\s*=\s*8/i.test(sql));
check('mapea con % 32 (uniforme por construcción)', /get_byte\([^)]*\)\s*%\s*32/.test(sql));
check('alfabeto Crockford Base32 exacto',
  sql.includes("'0123456789ABCDEFGHJKMNPQRSTVWXYZ'"));
check('longitud objetivo 20', /c_largo\s+constant\s+int\s*:=\s*20/i.test(sql));

// ─── 3. Helper: atributos aprobados ────────────────────────────────
console.log('  — helper _review_short_code —');
const helper = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public._review_short_code'),
                         sql.indexOf('COMMENT ON FUNCTION public._review_short_code'));
check('RETURNS text', /RETURNS\s+text/i.test(helper));
check('LANGUAGE plpgsql', /LANGUAGE\s+plpgsql/i.test(helper));
check('VOLATILE', /\bVOLATILE\b/i.test(helper));
check('SECURITY INVOKER explícito', /SECURITY\s+INVOKER/i.test(helper));
check('SET search_path a pg_catalog', /SET\s+search_path\s+TO\s+'pg_catalog'/i.test(helper));
for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
  check(`REVOKE ALL ... FROM ${rol}`,
    new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\._review_short_code\\(\\)\\s+FROM\\s+${rol}`, 'i').test(sql));
}

// ─── 4. generate_review_token: atributos conservados ───────────────
console.log('  — generate_review_token —');
const gen = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.generate_review_token'));
check('RETURNS trigger', /RETURNS\s+trigger/i.test(gen));
check('LANGUAGE plpgsql', /LANGUAGE\s+plpgsql/i.test(gen));
check('VOLATILE', /\bVOLATILE\b/i.test(gen));
check('SECURITY DEFINER', /SECURITY\s+DEFINER/i.test(gen));
check("SET search_path a 'public'", /SET\s+search_path\s+TO\s+'public'/i.test(gen));
check('sin argumentos (misma firma)', /generate_review_token\(\)/.test(gen));
check('conserva la búsqueda de atendida_id', /name\s*=\s*'atendida'/.test(gen));
check('conserva la condición de transición',
  /OLD\.status_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.status_id/i.test(gen));
check('conserva expires_at de 7 días', /now\(\)\s*\+\s*interval\s*'7 days'/i.test(gen));
check('conserva ON CONFLICT (appointment_id) DO NOTHING',
  /ON\s+CONFLICT\s*\(appointment_id\)\s*DO\s+NOTHING/i.test(gen));
check('conserva RETURN NEW', /RETURN\s+NEW;/.test(gen));
check('llama al helper', /public\._review_short_code\(\)/.test(gen));
check('YA NO concatena dos UUID',
  /replace\(gen_random_uuid\(\)::text,\s*'-',\s*''\)\s*\|\|/.test(gen), false);

// ─── 5. Guardas PRE/POST bloqueantes ───────────────────────────────
console.log('  — guardas —');
const pre  = sql.slice(sql.indexOf('DO $pre$'),  sql.indexOf('$pre$;'));
const post = sql.slice(sql.indexOf('DO $post$'), sql.indexOf('$post$;'));
check('el PRE aborta con RAISE EXCEPTION', /RAISE EXCEPTION 's7_72 PRE:/.test(pre));
check('el PRE cubre owner, prosecdef, volatility, return y search_path',
  /proowner/.test(pre) && /prosecdef/.test(pre) && /provolatile/.test(pre)
  && /pg_get_function_result/.test(pre) && /search_path=/.test(pre));
check('el PRE verifica el trigger y su definición',
  /trg_generate_review_token/.test(pre) && /AFTER UPDATE OF status_id/i.test(pre));
check('el PRE verifica review_tokens.token = text', /review_tokens/.test(pre) && /'text'/.test(pre));
check('el PRE toma snapshot de los grants', /set_config\('s7_72\.acl_gen'/.test(pre));
check('el POST aborta con RAISE EXCEPTION', /RAISE EXCEPTION 's7_72 POST:/.test(post));
check('el POST comprueba PUBLIC por ACL, no con has_function_privilege',
  /aclexplode\(h\.proacl\)/.test(post) && /grantee\s*=\s*0/.test(post)
  && !/has_function_privilege\('public'/.test(post));
check('el POST trata proacl NULL como "PUBLIC tiene EXECUTE"',
  /h\.proacl\s+IS\s+NULL/.test(post));
check('el POST comprueba anon, authenticated y service_role',
  (post.match(/has_function_privilege\('(anon|authenticated|service_role)'/g) || []).length === 3);
check('los SELECT INTO de rowtype usan pr.* y no *',
  /SELECT\s+\*\s+INTO\s+[phg]\b/.test(sql), false);
check('el POST compara los grants contra el snapshot', /s7_72\.acl_gen/.test(post));
check('el POST verifica que el OID no cambió (no se recreó)', /s7_72\.oid_gen/.test(post));
check('el POST verifica submit_review sin modificar', /submit_review/.test(post));
check('el POST prueba el generador en caliente', /_review_short_code\(\)/.test(post) && /\^\[0-9A-HJKMNP-TV-Z\]\{20\}\$/.test(post));
check('NO usa tablas temporales (gotcha del SQL Editor)', /CREATE\s+TEMP/i.test(sql), false);

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_72: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
