/**
 * check-mis-atenciones-refresh.mjs — una cita recién creada debe verse de
 * inmediato en "Mis atenciones" (sin logout/refresh/reingreso).
 *
 *   node scripts/check-mis-atenciones-refresh.mjs
 *
 * Inspección de TEXTO FUENTE (sin red / sin Supabase / sin datos). La DB sigue
 * siendo la fuente de verdad: no se agrega ninguna cita falsa al estado local.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (desc, got, expected) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc} → ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const read = (p) => fs.readFileSync(p, 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); const j = b ? src.indexOf(b, i + 1) : src.length; return i < 0 ? '' : src.slice(i, j < 0 ? src.length : j); };

console.log('\ncheck-mis-atenciones-refresh — cita visible de inmediato\n');

// ─── BookingCard: invalida la consulta del paciente tras crear la cita ──
{
  const src = read('src/pages/doctor-detail/components/BookingCard.tsx');
  check('BookingCard importa useQueryClient', /import \{ useQueryClient \} from '@tanstack\/react-query'/.test(src), true);
  check('BookingCard obtiene el queryClient', /const queryClient = useQueryClient\(\)/.test(src), true);
  // La invalidación ocurre en el éxito de completeBooking (tras createBookingWithIntent).
  const complete = between(src, 'const completeBooking', 'const registerIntentBeforeOtp');
  check('completeBooking invalida [\'my-appointments\'] en el éxito',
    /res\.ok[\s\S]*invalidateQueries\(\{ queryKey: \['my-appointments'\] \}\)/.test(complete), true);
  check('la invalidación va DESPUÉS de createBookingWithIntent',
    complete.indexOf('createBookingWithIntent(') >= 0 &&
    complete.indexOf('createBookingWithIntent(') < complete.indexOf("invalidateQueries({ queryKey: ['my-appointments'] })"), true);
  // No se agrega una cita falsa al estado local (solo invalidación).
  check('no inyecta una cita al estado local (setQueryData de my-appointments)',
    /setQueryData\(\s*\[\s*'my-appointments'/.test(src), false);
}

// ─── MisAtencionesPage: fetch fresco al abrir ──────────────────────────
{
  const src = read('src/pages/paciente/MisAtencionesPage.tsx');
  const q = between(src, "queryKey: ['my-appointments', page]", '});');
  check("useQuery de 'my-appointments' con refetchOnMount: 'always'", /refetchOnMount:\s*'always'/.test(q), true);
  check('sigue consultando listMyAppointments (fuente = DB)', /listMyAppointments\(\{ page, pageSize: PAGE_SIZE \}\)/.test(q), true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-mis-atenciones-refresh: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
