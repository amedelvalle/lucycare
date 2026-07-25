/**
 * check-auth-p1b2a-login-gating.mjs — verificación del gating del login
 * genérico (AUTH-P1B2A).
 *
 *   node scripts/check-auth-p1b2a-login-gating.mjs
 *
 * Comprueba, SIN red / SIN Supabase / SIN service_role / SIN datos:
 *   1. el mapa REAL OTP_SHOULD_CREATE_USER (bundle de auth.service.ts):
 *        login → false · booking → true · claim → true ·
 *        activation → true · recovery → false · sin contextos extra;
 *   2. sobre el TEXTO FUENTE de auth.service.ts:
 *        · sendOtp pasa shouldCreateUser: OTP_SHOULD_CREATE_USER[context]
 *          (el flag se decide por el mapa, no hardcodeado);
 *        · verifyOtp NO cambió su semántica: usa type: 'sms' y NO menciona
 *          shouldCreateUser (no crea usuarios al verificar);
 *        · existe NO_ACCOUNT_LOGIN_MESSAGE y sendOtp lo devuelve;
 *   3. este frente NO tocó grants ni intents: ningún archivo bajo migrations/
 *      difiere respecto de la base (git).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')),
  'bin',
  'esbuild',
);

let pass = 0;
let fail = 0;
const check = (desc, got, expected) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc} → ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};

console.log('\ncheck-auth-p1b2a-login-gating — gating del login genérico\n');

// ─── 1. Mapa REAL OTP_SHOULD_CREATE_USER (bundle) ───────────────
{
  if (!globalThis.localStorage) {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
      key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    };
  }
  const svcFile = path.join(os.tmpdir(), `auth-service-p1b2a-${Date.now()}.mjs`);
  execFileSync(process.execPath, [
    esbuildBin, 'src/services/auth.service.ts', '--bundle', '--platform=node',
    '--format=esm', '--external:@supabase/supabase-js',
    `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify('http://localhost:54321')}`,
    `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify('dummy-key-check')}`,
    `--outfile=${svcFile}`,
  ], { stdio: 'pipe' });
  const { OTP_SHOULD_CREATE_USER, NO_ACCOUNT_LOGIN_MESSAGE } = await import(pathToFileURL(svcFile).href);

  const APPROVED = { login: false, booking: true, claim: true, activation: true, recovery: false };
  // Aserciones EXPLÍCITas pedidas por el frente.
  check('login → shouldCreateUser=false', OTP_SHOULD_CREATE_USER.login, false);
  check('booking → shouldCreateUser=true', OTP_SHOULD_CREATE_USER.booking, true);
  check('claim → shouldCreateUser=true', OTP_SHOULD_CREATE_USER.claim, true);
  check('activation → shouldCreateUser=true', OTP_SHOULD_CREATE_USER.activation, true);
  check('recovery → shouldCreateUser=false', OTP_SHOULD_CREATE_USER.recovery, false);
  check('sin contextos extra no aprobados',
    Object.keys(OTP_SHOULD_CREATE_USER).sort().join(','), Object.keys(APPROVED).sort().join(','));
  check('NO_ACCOUNT_LOGIN_MESSAGE exportado y no vacío',
    typeof NO_ACCOUNT_LOGIN_MESSAGE === 'string' && NO_ACCOUNT_LOGIN_MESSAGE.length > 0, true);

  try { fs.unlinkSync(svcFile); } catch { /* tmp */ }
}

// ─── 2. Texto fuente de auth.service.ts ─────────────────────────
{
  const src = fs.readFileSync('src/services/auth.service.ts', 'utf8');

  // sendOtp decide el flag por el mapa, no hardcodeado.
  check('sendOtp usa shouldCreateUser: OTP_SHOULD_CREATE_USER[context]',
    /shouldCreateUser:\s*OTP_SHOULD_CREATE_USER\[context\]/.test(src), true);

  // verifyOtp: semántica intacta (type 'sms', sin shouldCreateUser).
  const verifyBody = src.slice(src.indexOf('export async function verifyOtp'),
                              src.indexOf('async function runPostLoginSideEffects'));
  check('verifyOtp presente para inspección', verifyBody.length > 0, true);
  check("verifyOtp conserva type: 'sms'", /type:\s*'sms'/.test(verifyBody), true);
  check('verifyOtp NO menciona shouldCreateUser',
    /shouldCreateUser/.test(verifyBody), false);

  // sendOtp devuelve el mensaje de "sin cuenta".
  const sendBody = src.slice(src.indexOf('export async function sendOtp'),
                             src.indexOf('export async function verifyOtp'));
  check('sendOtp devuelve NO_ACCOUNT_LOGIN_MESSAGE',
    /error:\s*NO_ACCOUNT_LOGIN_MESSAGE/.test(sendBody), true);
  check("sendOtp detecta el caso 'otp_disabled' / signups not allowed",
    /otp_disabled/.test(sendBody) && /signups/i.test(sendBody) && /not.+allowed/i.test(sendBody), true);
}

// ─── 3. Grants / intents intactos: nada bajo migrations/ cambió ──
{
  // Base de comparación: primer padre que exista en el árbol. En este frente
  // la base es `main`; si no está disponible, se usa el merge-base con HEAD~.
  let base = 'main';
  try {
    execFileSync('git', ['rev-parse', '--verify', 'main'], { stdio: 'pipe' });
  } catch {
    base = 'HEAD';
  }
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const migrationsTouched = changed.filter((f) => f.startsWith('migrations/'));
  check('ningún archivo bajo migrations/ modificado (grants/intents intactos)',
    migrationsTouched.length, 0);
  // También: no se tocó ninguna RPC/hook de s7_65/s7_66/s7_67.
  const authInfraTouched = changed.filter((f) => /s7_6[567]/.test(f));
  check('ninguna migración s7_65/66/67 modificada', authInfraTouched.length, 0);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-auth-p1b2a-login-gating: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
