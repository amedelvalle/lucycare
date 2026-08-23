/**
 * check-s7_75.mjs — SEED-CLAIM-PHONE-SMS-CAPABLE, verificación ESTÁTICA.
 *
 *   node scripts/check-s7_75.mjs
 *
 * Sin red, sin Supabase, sin service_role, sin datos: analiza el texto de la
 * migración, del rollback y de `s7_73`. La verificación CONDUCTUAL vive en las
 * guardas POST de la propia migración —fijo rechazado, móviles aceptados,
 * extranjero rechazado, `auth_phone_e164` intacta—, así que abortan la
 * transacción si la promesa no se cumple.
 *
 * Invariante que protege: `s7_75` debe ser QUIRÚRGICA. Cambia UNA regla en
 * TRES lecturas del teléfono de claim, y nada más.
 */
import fs from 'node:fs';

const MIG = 'migrations/s7_75_seed_claim_phone_sms_capable.sql';
const RBK = 'docs/rollbacks/s7_75_rollback.sql';
const S73 = 'migrations/s7_73_admin_seed_doctor.sql';

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

console.log('\ncheck-s7_75 — SEED-CLAIM-PHONE-SMS-CAPABLE (estático)\n');

for (const f of [MIG, RBK, S73]) {
  check(`existe ${f}`, fs.existsSync(f));
}
if (!fs.existsSync(MIG) || !fs.existsSync(RBK)) {
  console.log('\n❌ Faltan archivos: no se puede continuar.\n');
  process.exit(1);
}

const sql = fs.readFileSync(MIG, 'utf8');
const rbk = fs.readFileSync(RBK, 'utf8');
const s73 = fs.readFileSync(S73, 'utf8');
/** Las prohibiciones se evalúan sobre CÓDIGO, nunca sobre la prosa. */
const code = sql.replace(/--.*$/gm, '');

// ─── A. El helper ────────────────────────────────────────────
console.log('\n  A) el helper privado\n');
check('crea _seed_claim_phone_e164(text)',
  /CREATE OR REPLACE FUNCTION public\._seed_claim_phone_e164\(p_input text\)/.test(code));
check('reusa auth_phone_e164 (no reimplementa la canonicalización)',
  /public\.auth_phone_e164\(p_input\)/.test(code));
check('la regla es el móvil SV: [67] + 7 dígitos',
  /\^\\\+503\[67\]\[0-9\]\{7\}\$/.test(code));
check('IMMUTABLE — válido porque auth_phone_e164 también lo es',
  /IMMUTABLE/.test(code) && /IMMUTABLE/.test(s73.slice(0, 0) + fs.readFileSync('migrations/s7_65_auth_eligibility_hook.sql', 'utf8')));
check('search_path fijado en el helper', /SET search_path = pg_catalog/.test(code));

// ─── B. Privacidad efectiva del helper ───────────────────────
console.log('\n  B) el helper NO es público\n');
for (const rol of ['PUBLIC', 'anon', 'authenticated']) {
  check(`REVOKE explícito para ${rol}`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\._seed_claim_phone_e164\\(text\\) FROM ${rol};`).test(code));
}
check('no concede EXECUTE a nadie (las RPCs lo usan como owner)',
  !/GRANT[\s\S]*_seed_claim_phone_e164/.test(code));
check('POST verifica la ACL efectiva del helper',
  /el helper quedo accesible para anon\/authenticated/.test(sql)
  && /el helper conserva EXECUTE para PUBLIC/.test(sql));

// ─── C. Las tres sustituciones, y nada más ───────────────────
console.log('\n  C) alcance quirúrgico\n');
check('reemplaza exactamente las dos RPCs',
  /CREATE OR REPLACE FUNCTION public\.admin_claim_seed_operation\(/.test(code)
  && /CREATE OR REPLACE FUNCTION public\.admin_create_seed_doctor\(/.test(code));
check('las tres lecturas del claim usan el helper',
  (code.match(/public\._seed_claim_phone_e164\(v_claim_phone\)/g) || []).length === 2
  && /public\._seed_claim_phone_e164\(coalesce\(p\.phone, ''\)\)/.test(code));
check('NO redefine auth_phone_e164',
  !/CREATE OR REPLACE FUNCTION public\.auth_phone_e164/.test(code));
check('no toca tablas', !/(ALTER|CREATE|DROP)\s+TABLE/i.test(code));
check('no toca policies ni RLS', !/CREATE POLICY|ALTER POLICY|ROW LEVEL SECURITY/i.test(code));
check('no toca auth.users', !/auth\.users/i.test(code));
check('no altera los grants de las RPCs',
  !/GRANT[\s\S]*admin_(claim_seed_operation|create_seed_doctor)/.test(code));
check('no crea códigos de error nuevos: reusa P0133',
  /P0133/.test(sql) && !/P013[4-9]/.test(sql));

// ─── D. Los cuerpos derivan de s7_73 sin otros cambios ───────
console.log('\n  D) los cuerpos derivan de s7_73\n');
const cuerpoDe = (txt, nombre) => {
  const l = txt.split('\n');
  const i = l.findIndex((x) => x.startsWith(`CREATE OR REPLACE FUNCTION public.${nombre}(`));
  if (i < 0) return null;
  let j = -1;
  for (let k = i + 1; k < l.length; k++) if (l[k].trim() === '$$;') { j = k; break; }
  return l.slice(i, j + 1).join('\n');
};
/** Compara SOLO código: los comentarios sí se actualizaron, a propósito. */
const soloCodigo = (t) => t.split('\n').filter((x) => !/^\s*--/.test(x) && x.trim() !== '');

for (const nombre of ['admin_claim_seed_operation', 'admin_create_seed_doctor']) {
  const viejo = soloCodigo(cuerpoDe(s73, nombre) ?? '');
  const nuevo = soloCodigo(cuerpoDe(sql, nombre) ?? '');
  const mismasLineas = viejo.length === nuevo.length;
  const distintas = mismasLineas
    ? viejo.filter((l, i) => l !== nuevo[i]).length
    : -1;
  const esperado = nombre === 'admin_claim_seed_operation' ? 1 : 2;
  check(`${nombre}: mismo número de líneas de código`, mismasLineas, `${viejo.length} vs ${nuevo.length}`);
  check(`${nombre}: exactamente ${esperado} línea(s) distinta(s)`, distintas === esperado, `distintas=${distintas}`);
  check(`${nombre}: la única diferencia es la sustitución de función`,
    mismasLineas && viejo.every((l, i) =>
      l === nuevo[i] || l.replace(/public\.auth_phone_e164\(/g, 'public._seed_claim_phone_e164(') === nuevo[i]));
}

// ─── E. Transacción y guardas ────────────────────────────────
console.log('\n  E) transacción y guardas\n');
check('una sola transacción BEGIN … COMMIT',
  (code.match(/^\s*BEGIN;$/gm) || []).length === 1
  && (code.match(/^\s*COMMIT;$/gm) || []).length === 1);
check('tiene guardas PRE y POST', /PRE fallo/.test(sql) && /POST fallo/.test(sql));
check('PRE exige que s7_73 esté aplicada', /faltan las RPCs de s7_73/.test(sql));
check('PRE detecta si auth_phone_e164 ya fue alterada',
  /auth_phone_e164 ya no acepta fijos/.test(sql));
check('POST verifica firmas y ausencia de sobrecargas', /hay sobrecargas de las RPCs/.test(sql));
check('POST verifica SECURITY DEFINER de ambas', /dejo de ser SECURITY DEFINER/.test(sql));
check('POST verifica el search_path exacto de ambas',
  /search_path=public, pg_catalog/.test(sql) && /search_path=public, auth, pg_catalog/.test(sql));
check('POST verifica ownership uniforme', /el ownership no es uniforme/.test(sql));
check('POST verifica que authenticated conserva EXECUTE', /authenticated perdio EXECUTE/.test(sql));
check('POST verifica que anon sigue sin EXECUTE', /anon gano EXECUTE/.test(sql));

// ─── F. Conducta prometida, comprobada al aplicar ────────────
console.log('\n  F) conducta verificada por las guardas POST\n');
check('fijo 22220073 → rechazado como claim', /un fijo sigue siendo aceptado como claim/.test(sql));
check('móvil 60069973 → +50360069973', /_seed_claim_phone_e164\('60069973'\) <> '\+50360069973'/.test(sql));
check('móvil 70069973 → +50370069973', /_seed_claim_phone_e164\('70069973'\) <> '\+50370069973'/.test(sql));
check('extranjero → rechazado', /un numero extranjero sigue pasando como claim/.test(sql));
check('NULL y texto libre → NULL', /NULL o texto libre no dan NULL/.test(sql));
check('auth_phone_e164 GLOBAL sigue aceptando el fijo',
  /auth_phone_e164\('22220073'\) <> '\+50322220073'/.test(sql));
check('POST prueba que ninguna RPC usa ya la global para el claim',
  /prosrc LIKE '%public\.auth_phone_e164\(%'\) <> 0/.test(sql));
check('POST prueba que las dos RPCs adoptaron el helper',
  /prosrc LIKE '%public\._seed_claim_phone_e164\(%'\) <> 2/.test(sql));

// ─── G. Rollback ─────────────────────────────────────────────
console.log('\n  G) rollback\n');
check('elimina el helper', /DROP FUNCTION IF EXISTS public\._seed_claim_phone_e164\(text\);/.test(rbk));
check('está marcado como NO EJECUTAR', /NO EJECUTAR/.test(rbk));
check('advierte que el estado resultante es más permisivo',
  /ESTRICTAMENTE MÁS PERMISIVO/.test(rbk));
/*
 * Ojo con las dos comprobaciones siguientes: los cuerpos restaurados
 * CONTIENEN DML legítimo (insertan clinics/doctors/credenciales) y la prosa
 * de la cabecera NOMBRA psql para decir que no hace falta. Evaluar el archivo
 * entero daría falsos positivos, así que se mira solo lo que rodea a los
 * cuerpos, sin comentarios.
 */
const rbkFuera = rbk
  .replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g, '<<CUERPO>>')
  .replace(/--.*$/gm, '');
check('el rollback no hace DML propio ni toca auth.users',
  !/auth\.users/i.test(rbkFuera)
  && !/INSERT INTO|DELETE FROM|UPDATE public\./i.test(rbkFuera));

/*
 * AUTOSUFICIENCIA — requisito bloqueante.
 *
 * Un rollback que exige pegar fragmentos de otra migración no es un rollback,
 * es una instrucción: copiado tal cual al SQL Editor haría el DROP del helper
 * dejando las dos RPCs apuntando a una función inexistente. Por eso los
 * cuerpos van duplicados literalmente, y estos checks demuestran que ese
 * duplicado corresponde EXACTAMENTE a `s7_73`.
 */
console.log('\n  G-bis) el rollback es autosuficiente\n');
check('no quedan marcadores para pegar a mano',
  !/PEGAR AQU/i.test(rbk) && !/⬇️/.test(rbk));
check('no depende de \\i, psql, ni scripts',
  !/\\i\s/.test(rbkFuera) && !/psql/i.test(rbkFuera) && !/node scripts/.test(rbkFuera));
check('incluye los DOS cuerpos completos',
  /CREATE OR REPLACE FUNCTION public\.admin_claim_seed_operation\(/.test(rbk)
  && /CREATE OR REPLACE FUNCTION public\.admin_create_seed_doctor\(/.test(rbk)
  && (rbk.match(/^CREATE OR REPLACE FUNCTION/gm) || []).length === 2);
check('los cuerpos restaurados usan la GLOBAL, no el helper',
  (rbk.match(/public\.auth_phone_e164\(v_claim_phone\)/g) || []).length === 2
  && /public\.auth_phone_e164\(coalesce\(p\.phone, ''\)\)/.test(rbk)
  && !/public\._seed_claim_phone_e164\(v_claim_phone\)/.test(rbk));
check('el DROP va DESPUÉS de los dos cuerpos',
  rbk.indexOf('CREATE OR REPLACE FUNCTION public.admin_create_seed_doctor(')
    < rbk.indexOf('DROP FUNCTION IF EXISTS public._seed_claim_phone_e164'));
check('una sola transacción BEGIN … COMMIT',
  (rbk.match(/^BEGIN;$/gm) || []).length === 1 && (rbk.match(/^COMMIT;$/gm) || []).length === 1);

// Correspondencia carácter por carácter con la fuente.
for (const nombre of ['admin_claim_seed_operation', 'admin_create_seed_doctor']) {
  const fuente = cuerpoDe(s73, nombre);
  const incluido = cuerpoDe(rbk, nombre);
  check(`${nombre}: el cuerpo del rollback coincide con s7_73 carácter por carácter`,
    !!fuente && !!incluido && fuente === incluido,
    fuente && incluido ? `len ${fuente.length} vs ${incluido.length}` : 'no se pudo extraer');
}

console.log('\n  G-ter) guardas POST del rollback\n');
check('POST: el helper ya no existe', /el helper sigue existiendo/.test(rbk));
check('POST: ninguna RPC lo referencia', /sigue referenciando el helper eliminado/.test(rbk));
check('POST: los dos cuerpos volvieron a la global',
  /los cuerpos originales no quedaron restaurados/.test(rbk));
check('POST: firmas sin sobrecargas', /hay sobrecargas de las RPCs/.test(rbk));
check('POST: SECURITY DEFINER conservado', /dejo de ser SECURITY DEFINER/.test(rbk));
check('POST: search_path exacto de ambas',
  /search_path=public, pg_catalog/.test(rbk) && /search_path=public, auth, pg_catalog/.test(rbk));
check('POST: ownership y ACL conservados',
  /el ownership no es uniforme/.test(rbk)
  && /authenticated perdio EXECUTE/.test(rbk) && /anon gano EXECUTE/.test(rbk));
check('POST: demuestra la conducta anterior restaurada',
  /auth_phone_e164\('22220073'\) <> '\+50322220073'/.test(rbk));

// ─── H. s7_73 intacta ────────────────────────────────────────
console.log('\n  H) s7_73 intacta\n');
// Ojo: s7_73 nombra `public.auth_phone_e164(` cuatro veces — las TRES
// llamadas reales más el `to_regprocedure` de su guarda PRE, que es una
// cadena, no una invocación. Se afirman las tres llamadas por separado.
check('s7_73 conserva sus tres llamadas originales a auth_phone_e164',
  (s73.match(/public\.auth_phone_e164\(v_claim_phone\)/g) || []).length === 2
  && /public\.auth_phone_e164\(coalesce\(p\.phone, ''\)\)/.test(s73));
check('s7_73 NO fue reescrita para incorporar el helper',
  !/_seed_claim_phone_e164/.test(s73));

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
