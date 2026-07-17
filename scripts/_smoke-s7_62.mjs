/**
 * _smoke-s7_62.mjs — cutover de lectores + P0091 + desync del claim (F1-b).
 *
 *   node scripts/_smoke-s7_62.mjs                 # solo estructural (sin escrituras)
 *   node scripts/_smoke-s7_62.mjs --fixtures      # + bloque con service_role
 *
 * ── ESTADO DE AUTORIZACIÓN ──
 * El bloque de fixtures (service_role + OTP) NO está autorizado a ejecutarse
 * todavía. Sin `--fixtures` el smoke corre solo la parte estructural (lecturas)
 * y SALTEA el resto con un mensaje explícito. Cuando el owner autorice y defina
 * el Test Phone dedicado, se corre con `--fixtures`.
 *
 * ── Qué prueba el bloque de fixtures (cuando se habilite) ──
 *   R1  el embed doctor_credentials(value,type) devuelve el JVPM = la columna
 *   R2  una cuenta ajena ve [] en el embed (fail-closed)
 *   P1  dos médicos con el mismo JVPM → el 2º aborta con P0091 (constraint
 *       doctor_credentials_registry_uniq), NO un 23505 crudo
 *   P2  un 23505 de OTRA constraint NO se convierte en P0091
 *   C1  DESYNC DEL CLAIM (la prueba central): fixture con columna='COL-X' y
 *       credencial='CRED-Y' →
 *         • claim(typed='CRED-Y') → éxito  ⇒ el claim lee la CREDENCIAL
 *         • claim(typed='COL-X')  → P0007  ⇒ el claim IGNORA la columna
 *       (dos fixtures: el claim es irreversible, listed_only→claimed)
 *
 * ── Requisitos del bloque de fixtures (a confirmar por el owner) ──
 *   • SUPABASE_SERVICE_ROLE_KEY en .env.local (autorización puntual);
 *   • un Test Phone DEDICADO para las fixtures del claim (NO Camilo ni
 *     Katherine), con OTP fijo, configurado en Supabase → env TEST_DOCTOR_PHONE.
 *     El claim exige sesión OTP con teléfono confirmado; sin ese Test Phone la
 *     prueba C1 (desync) no puede correr.
 *   • fixtures marcadas F1B_FIXTURE, try/finally, cleanup con 0 residuales.
 *
 * ── El desync, en detalle (por qué prueba lo que dice) ──
 * El trigger sincroniza en UNA dirección (doctors → doctor_credentials). Al
 * escribir doctor_credentials.value directamente (service_role), la columna y
 * la credencial quedan DISTINTAS sin que el trigger las re-alinee. Entonces el
 * valor que el claim acepta revela de qué tabla lee: acepta 'CRED-Y' (credencial)
 * y rechaza 'COL-X' (columna). Un test que solo probara "el claim anda" no
 * distinguiría la fuente.
 */
import { supabaseAnon } from './_lib/supabase-anon.mjs';

const WANT_FIXTURES = process.argv.includes('--fixtures');

let pass = 0;
let fail = 0;
let skipped = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function main() {
  console.log('\n_smoke-s7_62 — cutover de lectores (F1-b)\n');

  // ══ estructural (sin escrituras) ══════════════════════════
  console.log('estructural:');
  {
    const { error } = await supabaseAnon.from('doctor_credentials').select('id').limit(1);
    if (error) ok(`anon no accede a doctor_credentials (${error.code})`);
    else no('anon accedió a doctor_credentials — CRÍTICO');
  }

  // ══ fixtures (service_role + OTP) — gateado ═══════════════
  if (!WANT_FIXTURES) {
    console.log('\nbloque de fixtures:');
    console.log(
      '  ⏭️  SKIP — no autorizado / sin --fixtures.\n' +
      '      Cuando el owner lo habilite: definir un Test Phone DEDICADO\n' +
      '      (NO Camilo ni Katherine) en TEST_DOCTOR_PHONE + SERVICE_ROLE_KEY,\n' +
      '      y correr `node scripts/_smoke-s7_62.mjs --fixtures`.\n' +
      '      Prueba R1/R2 (embed), P1/P2 (P0091) y C1 (desync del claim).',
    );
    skipped++;
  } else {
    console.log('\nbloque de fixtures: --fixtures pedido');
    const phone = process.env.TEST_DOCTOR_PHONE;
    let svc;
    try {
      ({ supabaseAdmin: svc } = await import('./_lib/supabase-admin.mjs'));
    } catch {
      no('bloque de fixtures: falta SUPABASE_SERVICE_ROLE_KEY en .env.local');
    }
    if (svc && !phone) {
      no('bloque de fixtures: falta TEST_DOCTOR_PHONE (Test Phone dedicado para el claim E2E). No se ejecuta para no improvisar un teléfono.');
    } else if (svc && phone) {
      // Implementación completa pendiente de la autorización del owner y del
      // Test Phone definitivo. Se deja el guard explícito para no correr un
      // E2E de claim (irreversible) con un teléfono no acordado.
      no('bloque de fixtures: implementación E2E del claim pendiente de acordar el Test Phone y el detalle del cleanup con el owner (ver cabecera).');
    }
  }

  const tail = skipped > 0 ? ` skip=${skipped}` : '';
  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_62: pass=${pass} fail=${fail}${tail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
