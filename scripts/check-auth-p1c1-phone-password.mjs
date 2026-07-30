/**
 * check-auth-p1c1-phone-password.mjs — verificación del acceso por teléfono +
 * contraseña con contraseña obligatoria tras el primer OTP (AUTH-P1C1).
 *
 *   node scripts/check-auth-p1c1-phone-password.mjs
 *
 * SIN red / SIN Supabase / SIN service_role / SIN datos. Combina:
 *   1. el mapa REAL OTP_SHOULD_CREATE_USER (bundle de auth.service.ts);
 *   2. inspección del TEXTO FUENTE de LoginModal/BookingCard/ClaimProfileModal/
 *      auth.service para demostrar el cableado y la no-regresión;
 *   3. git: sin cambios en migraciones ni hooks.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');

let pass = 0, fail = 0;
const check = (desc, got, expected) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc} → ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const read = (p) => fs.readFileSync(p, 'utf8');
const between = (src, a, b) => {
  const i = src.indexOf(a); const j = b ? src.indexOf(b, i + 1) : src.length;
  return i < 0 ? '' : src.slice(i, j < 0 ? src.length : j);
};

console.log('\ncheck-auth-p1c1-phone-password — acceso teléfono+contraseña + contraseña obligatoria\n');

// ─── 1. Mapa REAL OTP_SHOULD_CREATE_USER ────────────────────────
{
  if (!globalThis.localStorage) {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    };
  }
  const svcFile = path.join(os.tmpdir(), `auth-service-p1c1-${Date.now()}.mjs`);
  execFileSync(process.execPath, [
    esbuildBin, 'src/services/auth.service.ts', '--bundle', '--platform=node', '--format=esm',
    '--external:@supabase/supabase-js',
    `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify('http://localhost:54321')}`,
    `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify('dummy')}`,
    `--outfile=${svcFile}`,
  ], { stdio: 'pipe' });
  const { OTP_SHOULD_CREATE_USER } = await import(pathToFileURL(svcFile).href);
  check('booking nuevo conserva create_user=true', OTP_SHOULD_CREATE_USER.booking, true);
  check('recuperación por código (login) usa shouldCreateUser=false', OTP_SHOULD_CREATE_USER.login, false);
  check('claim conserva shouldCreateUser=true', OTP_SHOULD_CREATE_USER.claim, true);
  try { fs.unlinkSync(svcFile); } catch { /* tmp */ }
}

// ─── 2. LoginModal: login genérico usa teléfono + contraseña ────
{
  const src = read('src/pages/doctor-detail/components/LoginModal.tsx');
  check('LoginModal importa signInWithPhonePassword', /import[\s\S]*signInWithPhonePassword[\s\S]*from '\.\.\/\.\.\/\.\.\/services\/auth\.service'/.test(src), true);
  // [,)] tolera argumentos añadidos después (p.ej. captchaToken en AUTH-P1D2).
  check('signInWithPhonePassword tiene caller real (LoginModal)', /signInWithPhonePassword\(fullPhone, loginPassword[,)]/.test(src), true);
  check("PhoneStep incluye 'credentials'/'otp'/'set_password'",
    /'credentials'/.test(src) && /'otp'/.test(src) && /'set_password'/.test(src), true);
  check('el paso credentials tiene input de contraseña (current-password)',
    /autoComplete="current-password"[\s\S]*value=\{loginPassword\}/.test(src), true);
  check('acción secundaria "Usar un código" presente', /Usar un código/.test(src), true);

  // "Usar un código" envía OTP con el contexto (login→false, booking→true)
  const useCode = between(src, 'const handleUseCode', 'const handleVerifyOtp');
  check('handleUseCode envía OTP con el contexto', /sendOtp\(fullPhone, context[,)]/.test(useCode), true);

  // verifyOtp handler: usa el cliente TRANSITORIO, NO completa el acceso.
  const verify = between(src, 'const handleVerifyOtp', 'const handleResendOtp');
  check('handleVerifyOtp usa el cliente transitorio (verifyOtpForPasswordSetup)',
    /verifyOtpForPasswordSetup\(fullPhone, otpCode\)/.test(verify), true);
  check("handleVerifyOtp lleva a set_password", /setPhoneStep\('set_password'\)/.test(verify), true);
  check('handleVerifyOtp NO llama onSuccess (no completa antes de la contraseña)', /onSuccess\(/.test(verify), false);
  check('LoginModal NO usa el verifyOtp principal (persistente) en el tab teléfono',
    /(^|[^A-Za-z])verifyOtp\(/.test(src), false);

  // set_password: (1) guardar contraseña con token transitorio → (2) login REAL
  // con signInWithPhonePassword → (3) completar. En ESE orden.
  const setpw = between(src, 'const handleSetPassword', 'const handleEmailLogin');
  check('handleSetPassword crea la contraseña (setPasswordFromClaim)', /setPasswordFromClaim\(newPassword,/.test(setpw), true);
  check('handleSetPassword hace login real (signInWithPhonePassword)', /signInWithPhonePassword\(fullPhone, newPassword\)/.test(setpw), true);
  check('orden: setPasswordFromClaim ANTES de signInWithPhonePassword',
    setpw.indexOf('setPasswordFromClaim(') >= 0 &&
    setpw.indexOf('setPasswordFromClaim(') < setpw.indexOf('signInWithPhonePassword('), true);
  check('handleSetPassword completa el acceso (onSuccess/navigate) tras el login',
    /onSuccess\(/.test(setpw) && /destinationForRole\(login\.user\.role\)/.test(setpw), true);
  check('la contraseña obligatoria usa la política central (MIN_PASSWORD_LENGTH)', /MIN_PASSWORD_LENGTH/.test(src), true);

  // login por correo sigue conectado
  check('login por correo sigue conectado (signInWithEmail)', /signInWithEmail\(email, password[,)]/.test(src), true);
}

// ─── 2b. auth.service: verifyOtpForPasswordSetup (cliente transitorio) ──
{
  const src = read('src/services/auth.service.ts');
  const fn = between(src, 'export async function verifyOtpForPasswordSetup', 'export function destinationForRole');
  check('verifyOtpForPasswordSetup existe (función separada)', fn.length > 0, true);
  check('usa createClient (cliente transitorio, no el principal)', /createClient\(/.test(fn), true);
  check('cliente transitorio persistSession:false', /persistSession:\s*false/.test(fn), true);
  check('cliente transitorio autoRefreshToken:false', /autoRefreshToken:\s*false/.test(fn), true);
  check('cliente transitorio detectSessionInUrl:false', /detectSessionInUrl:\s*false/.test(fn), true);
  check('verifica OTP con type sms', /type:\s*'sms'/.test(fn), true);
  check('verifyOtpForPasswordSetup NO corre side-effects', /runPostLoginSideEffects/.test(fn), false);
}

// ─── 3. BookingCard: la reserva se completa tras el login; el intent
//        se registra también en el camino de contraseña ─────────
{
  const src = read('src/pages/doctor-detail/components/BookingCard.tsx');
  // createBookingWithIntent SOLO se invoca dentro de completeBooking (1 sola call)
  const calls = (src.match(/createBookingWithIntent\(/g) || []).length;
  check('createBookingWithIntent se invoca 1 sola vez (dentro de completeBooking)', calls, 1);
  const complete = between(src, 'const completeBooking', 'const registerIntentBeforeOtp');
  check('completeBooking es quien llama createBookingWithIntent', /createBookingWithIntent\(\{ intentId, patientName \}\)/.test(complete), true);
  // handleLoginSuccess registra el intent cuando no vino de onBeforeSendOtp (login por contraseña)
  const onLogin = between(src, 'const handleLoginSuccess', 'const handleLogout');
  check('handleLoginSuccess registra el intent si falta (paciente existente por contraseña)',
    /if \(!effectiveIntentId\)[\s\S]*registerBookingIntent\(/.test(onLogin), true);
}

// ─── 4. ClaimProfileModal: claim + política central sin regresión ─
{
  const src = read('src/pages/doctor-detail/components/ClaimProfileModal.tsx');
  check('claim médico sigue conectado (claimDoctorProfile)', /claimDoctorProfile\(\{/.test(src), true);
  check('claim médico conserva el verifyOtp principal (intacto)', /verifyOtp\(fullPhone, otpCode\)/.test(src), true);
  check('ClaimProfileModal usa la política central (import de password)', /from '\.\.\/\.\.\/\.\.\/lib\/password'/.test(src), true);
  check('ClaimProfileModal ya no declara su propia constante local', /const MIN_PASSWORD_LEN = 8/.test(src), false);
}

// ─── 5. auth.service.verifyOtp NO fue debilitado ────────────────
{
  const src = read('src/services/auth.service.ts');
  const verify = between(src, 'export async function verifyOtp', 'async function runPostLoginSideEffects');
  check("verifyOtp conserva type: 'sms'", /type:\s*'sms'/.test(verify), true);
  check('verifyOtp NO menciona shouldCreateUser', /shouldCreateUser/.test(verify), false);
  check('verifyOtp sigue corriendo runPostLoginSideEffects', /runPostLoginSideEffects\(/.test(verify), true);
  check('signInWithPhonePassword definida en auth.service', /export async function signInWithPhonePassword/.test(src), true);
}

// ─── 6. Sin cambios en migraciones ni hooks ─────────────────────
{
  let base = 'main';
  try { execFileSync('git', ['rev-parse', '--verify', 'main'], { stdio: 'pipe' }); } catch { base = 'HEAD'; }
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  // Altas nuevas de migraciones en frentes posteriores (p.ej. s7_69 en
  // AUTH-P1D2) son legítimas; lo que NO debe ocurrir es modificar una
  // migración preexistente (--diff-filter=M excluye los archivos añadidos).
  const migrationsModified = execFileSync(
    'git', ['diff', '--diff-filter=M', '--name-only', base, '--', 'migrations/'],
    { encoding: 'utf8' },
  ).split('\n').map((s) => s.trim()).filter(Boolean);
  check('ninguna migración preexistente modificada', migrationsModified.length, 0);
  check('ninguna migración/hook s7_65/66/67 modificada', changed.filter((f) => /s7_6[567]/.test(f)).length, 0);
}

// ─── 7. Política de contraseña: fuente ÚNICA para creación/reset ────
{
  const reset = read('src/pages/reset-password/ResetPasswordPage.tsx');
  check('ResetPasswordPage importa MIN_PASSWORD_LENGTH', /from '@\/lib\/password'/.test(reset), true);
  check('ResetPasswordPage sin mínimo hardcodeado (password.length < 8)', /password\.length < 8\b/.test(reset), false);
  check('ResetPasswordPage valida con MIN_PASSWORD_LENGTH', /password\.length < MIN_PASSWORD_LENGTH/.test(reset), true);

  const svc = read('src/services/auth.service.ts');
  check('auth.service importa MIN_PASSWORD_LENGTH', /import \{ MIN_PASSWORD_LENGTH \} from '\.\.\/lib\/password'/.test(svc), true);
  check('setPasswordWithFetch sin "8 caracteres" hardcodeado', /al menos 8 caracteres/.test(svc), false);

  const claim = read('src/pages/doctor-detail/components/ClaimProfileModal.tsx');
  check('ClaimProfileModal sin placeholder "Mínimo 8 caracteres" hardcodeado', /Mínimo 8 caracteres/.test(claim), false);

  // El gate del LOGIN por EMAIL (>= 6) se mantiene (credencial existente, no creación).
  const login = read('src/pages/doctor-detail/components/LoginModal.tsx');
  check('gate del login por email conservado (isPasswordValid >= 6)', /password\.length >= 6/.test(login), true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-auth-p1c1-phone-password: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
