/**
 * check-s7_74.mjs — SEEDOPS-POLICY-HARDENING, verificación ESTÁTICA.
 *
 *   node scripts/check-s7_74.mjs
 *
 * Sin red, sin Supabase, sin service_role, sin datos: analiza el texto de la
 * migración y del rollback. La verificación LIVE del estado resultante es el
 * SQL read-only POST que ejecuta el owner (roles={authenticated},
 * USING=is_admin(), WITH CHECK NULL).
 *
 * Invariante que protege: `s7_74` debe ser QUIRÚRGICA. Solo cambia el sujeto
 * de una policy. Si alguna vez toca tabla, RPCs, Auth o datos, este check
 * falla.
 */
import fs from 'node:fs';

const MIG = 'migrations/s7_74_seedops_policy_hardening.sql';
const RBK = 'docs/rollbacks/s7_74_rollback.sql';

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

console.log('\ncheck-s7_74 — SEEDOPS-POLICY-HARDENING (estático)\n');

check('existe la migración', fs.existsSync(MIG));
check('existe el rollback', fs.existsSync(RBK));
if (!fs.existsSync(MIG) || !fs.existsSync(RBK)) {
  console.log('\n❌ Faltan archivos: no se puede continuar.\n');
  process.exit(1);
}

const sql = fs.readFileSync(MIG, 'utf8');
const rbk = fs.readFileSync(RBK, 'utf8');
/** Las prohibiciones se evalúan sobre CÓDIGO, nunca sobre la prosa del encabezado. */
const code = sql.replace(/--.*$/gm, '');

// ─── A. El cambio pedido ─────────────────────────────────────
console.log('  A) el cambio\n');
check('usa ALTER POLICY, no DROP + CREATE',
  /ALTER\s+POLICY\s+seedops_select_admin/i.test(code)
  && !/DROP\s+POLICY/i.test(code)
  && !/CREATE\s+POLICY/i.test(code));
check('deja la policy en TO authenticated',
  /ALTER\s+POLICY\s+seedops_select_admin[\s\S]{0,120}TO\s+authenticated\s*;/i.test(code));
check('hay exactamente un ALTER POLICY',
  (code.match(/ALTER\s+POLICY/gi) || []).length === 1);
check('NO reescribe el USING (se deja intacto)', !/ALTER\s+POLICY[\s\S]{0,200}USING\s*\(/i.test(code));
// Ojo: "WITH CHECK" también aparece dentro de los mensajes de las guardas.
// Lo que importa es que la SENTENCIA no lo agregue como cláusula.
check('NO introduce WITH CHECK en el ALTER POLICY',
  !/ALTER\s+POLICY[\s\S]{0,200}WITH\s+CHECK/i.test(code));

// ─── B. Quirúrgica: nada más se toca ─────────────────────────
console.log('\n  B) alcance quirúrgico\n');
check('no toca la tabla (sin ALTER TABLE / DROP / CREATE TABLE)',
  !/ALTER\s+TABLE/i.test(code) && !/CREATE\s+TABLE/i.test(code) && !/DROP\s+TABLE/i.test(code));
check('no toca funciones ni RPCs',
  !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(code) && !/DROP\s+FUNCTION/i.test(code));
check('no toca privilegios (sin GRANT ni REVOKE)',
  !/\bGRANT\b/i.test(code) && !/\bREVOKE\b/i.test(code));
check('no toca auth.users', !/auth\.users/i.test(code));
check('no escribe datos (sin INSERT/UPDATE/DELETE/TRUNCATE)',
  !/\bINSERT\s+INTO\b/i.test(code) && !/\bUPDATE\s+\w/i.test(code)
  && !/\bDELETE\s+FROM\b/i.test(code) && !/\bTRUNCATE\b/i.test(code));
check('no toca índices ni triggers',
  !/CREATE\s+INDEX/i.test(code) && !/CREATE\s+TRIGGER/i.test(code));

// ─── C. Transacción y guardas ────────────────────────────────
console.log('\n  C) transacción y guardas\n');
check('una sola transacción BEGIN … COMMIT',
  (code.match(/^\s*BEGIN\s*;/gm) || []).length === 1
  && (code.match(/^\s*COMMIT\s*;/gm) || []).length === 1);
check('tiene guardas PRE y POST', /PRE fallo/.test(sql) && /POST fallo/.test(sql));
check('PRE exige que s7_73 esté aplicada',
  /to_regclass\('public\.admin_seed_operations'\)\s+IS\s+NULL/i.test(code));
check('PRE exige exactamente 1 policy previa',
  /se esperaba exactamente 1 policy/.test(sql));
check('PRE admite el estado ya corregido (idempotente)',
  /rolname = 'authenticated'/.test(code) && /ARRAY\[0::oid\]/.test(code));
check('POST verifica roles = {authenticated}',
  /no quedo en TO authenticated/.test(sql));
check('POST verifica que el USING no cambió', /se altero el USING/.test(sql));
check('POST verifica que no apareció WITH CHECK', /aparecio un WITH CHECK/.test(sql));
check('POST verifica que RLS sigue activa', /relrowsecurity/.test(code));
check('POST verifica que ningún dato cambió',
  /set_config\('lucy\.s7_74_rows'/.test(code)
  && /current_setting\('lucy\.s7_74_rows'/.test(code));

// ─── D. Rollback ─────────────────────────────────────────────
console.log('\n  D) rollback\n');
check('el rollback devuelve la policy a TO public',
  /ALTER\s+POLICY\s+seedops_select_admin[\s\S]{0,120}TO\s+public\s*;/i.test(rbk));
check('el rollback está marcado como NO EJECUTAR', /NO EJECUTAR/.test(rbk));
check('el rollback tampoco toca datos ni Auth',
  !/auth\.users/i.test(rbk) && !/\bINSERT\s+INTO\b/i.test(rbk)
  && !/\bDELETE\s+FROM\b/i.test(rbk));

// ─── E. s7_73 intacta ────────────────────────────────────────
console.log('\n  E) s7_73 intacta\n');
const S73 = 'migrations/s7_73_admin_seed_doctor.sql';
const s73 = fs.readFileSync(S73, 'utf8');
check('s7_73 conserva su CREATE POLICY original, sin TO',
  /CREATE POLICY seedops_select_admin ON public\.admin_seed_operations\s*\n\s*FOR SELECT USING \(public\.is_admin\(\)\);/.test(s73));
check('s7_73 NO fue reescrita para corregir el estado live',
  !/ALTER\s+POLICY/i.test(s73));

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
