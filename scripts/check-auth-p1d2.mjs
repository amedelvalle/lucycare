/**
 * check-auth-p1d2.mjs — Consentimiento OTP + Cloudflare Turnstile (AUTH-P1D2).
 *
 *   node scripts/check-auth-p1d2.mjs
 *
 * Inspección de TEXTO FUENTE + verificación del hash del consentimiento.
 * Sin red / sin Supabase / sin service_role / sin datos.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');

let pass = 0, fail = 0;
const check = (desc, got, expected = true) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok ? '' : ` → ${JSON.stringify(got)} (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const read = (p) => fs.readFileSync(p, 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); const j = b ? s.indexOf(b, i + 1) : s.length; return i < 0 ? '' : s.slice(i, j < 0 ? s.length : j); };

const PRIMARY = 'Te enviaremos un código por SMS para verificar tu número.';
const SECONDARY = 'Al continuar, aceptas nuestra Política de Privacidad.';
const TEXT = `${PRIMARY} ${SECONDARY}`;
const HASH = '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692';
// Texto/hash del copy legal ANTERIOR (descartado): no deben quedar rastros.
const OLD_HASH = '378f1365ccfe53c660264d9a46ce37572d78e9a6f5beda79c8e16adfe3e48ba7';
const OLD_TEXT_FRAGMENT = 'Pueden aplicarse cargos de tu operador';

console.log('\ncheck-auth-p1d2 — consentimiento OTP + Turnstile\n');

// ─── 1. Consentimiento: canónico == visible, versión y hash ───
{
  const src = read('src/lib/otpConsent.ts');
  check("OTP_CONSENT_VERSION = 'otp-consent-v1'", /OTP_CONSENT_VERSION\s*=\s*'otp-consent-v1'/.test(src));
  check('copy visible primario exacto', src.includes(`'${PRIMARY}'`));
  check('copy visible secundario exacto', src.includes(`'${SECONDARY}'`));
  check('OTP_CONSENT_TEXT = PRIMARY + " " + SECONDARY (una sola cadena)',
    /OTP_CONSENT_TEXT\s*=\s*\r?\n?\s*`\$\{OTP_CONSENT_NOTICE_PRIMARY\} \$\{OTP_CONSENT_NOTICE_SECONDARY\}`/.test(src));
  check('OTP_CONSENT_TEXT_SHA256 es el hash nuevo', src.includes(`'${HASH}'`));
  check("OTP_PRIVACY_PATH = '/privacidad'", /OTP_PRIVACY_PATH\s*=\s*'\/privacidad'/.test(src));
  // Verificación REAL del hash sobre el texto exacto (no confianza ciega).
  check('sha256(texto visible unido) === hash', crypto.createHash('sha256').update(TEXT, 'utf8').digest('hex'), HASH);

  // ─── Sin rastros del copy legal anterior ───
  check('sin el hash anterior en el registro técnico', src.includes(OLD_HASH) === false);
  check('sin el texto legal anterior en el registro técnico', src.includes(OLD_TEXT_FRAGMENT) === false);
  const migration = read('migrations/s7_69_otp_consent_events.sql');
  check('migración con el hash nuevo', migration.includes(HASH));
  check('migración sin el hash anterior', migration.includes(OLD_HASH) === false);
  check('migración sin el texto legal anterior', migration.includes(OLD_TEXT_FRAGMENT) === false);

  const notice = read('src/components/OtpConsentNotice.tsx');
  check('OtpConsentNotice usa el copy visible', /OTP_CONSENT_NOTICE_PRIMARY/.test(notice) && /OTP_CONSENT_NOTICE_SECONDARY_PREFIX/.test(notice));
  check('OtpConsentNotice enlaza a /privacidad', /OTP_PRIVACY_PATH/.test(notice) && /OTP_CONSENT_NOTICE_LINK_LABEL/.test(notice));
  check('sin casilla ni modal en el aviso', /type="checkbox"|role="dialog"/.test(notice) === false);
  check('sin texto de cargos del operador en la interfaz', /cargos de tu operador/.test(notice) === false);
  check('aviso discreto (secundario en text-xs/gris)', /text-xs text-gray-400/.test(notice));
}

// ─── 1b. Registro OBLIGATORIO: sin RPC no hay OTP ───
{
  const src = read('src/services/auth.service.ts');
  check('recordOtpConsent devuelve boolean (no best-effort)',
    /async function recordOtpConsent\([\s\S]*?\): Promise<boolean>/.test(src));
  check('recordOtpConsent retorna false ante error de la RPC',
    /if \(error\) \{[\s\S]{0,220}?return false/.test(src));
  const send = between(src, 'export async function sendOtp', 'export async function verifyOtp');
  check('sendOtp aborta si el registro falla (no llama signInWithOtp)',
    /if \(!consentRecorded\) \{\s*return \{ success: false, error: CONSENT_RECORD_FAILED_MESSAGE \}/.test(send));
  check('el abort ocurre ANTES de signInWithOtp',
    send.indexOf('if (!consentRecorded)') >= 0 &&
    send.indexOf('if (!consentRecorded)') < send.indexOf('signInWithOtp('), true);
  check('mensaje genérico ante fallo del registro (sin detalles)',
    /CONSENT_RECORD_FAILED_MESSAGE =\s*\r?\n?\s*'No pudimos procesar la solicitud/.test(src));
  check('no se filtran límites/SQL al usuario (sin P0300/P0301 en copy)',
    /error:\s*['"`][^'"`]*P030[01]/.test(src) === false);
  check('request_id NUEVO por llamada (generado si no se pasa)',
    /const rid =\s*\r?\n?\s*requestId \|\|/.test(src) && /randomUUID/.test(src));
  // El reenvío usa el MISMO sendOtp → hereda el bloqueo obligatorio.
  const login = read('src/pages/doctor-detail/components/LoginModal.tsx');
  check('reenvío pasa por sendOtp (hereda el registro obligatorio)',
    /const handleResendOtp[\s\S]*?sendOtp\(fullPhone, context/.test(login));
  check('la UI no reutiliza request_id entre intentos (no lo pasa)',
    /requestId:/.test(login) === false);
}

// ─── 2. authFlags: bandera CAPTCHA + fail-closed + suspensión de teléfono ───
{
  const src = read('src/lib/authFlags.ts');
  check("CAPTCHA_ENABLED por VITE_CAPTCHA_ENABLED === 'true'", /VITE_CAPTCHA_ENABLED\s*===\s*'true'/.test(src));
  check('TURNSTILE_SITE_KEY de VITE_TURNSTILE_SITE_KEY', /VITE_TURNSTILE_SITE_KEY/.test(src));
  check('fail-closed si habilitado y sin site key', /captchaMisconfigured/.test(src) && /CAPTCHA_ENABLED && TURNSTILE_SITE_KEY\.length === 0/.test(src));
  check('PHONE_CHANGE_SUSPENDED se deriva de CAPTCHA_ENABLED (bandera única)',
    /PHONE_CHANGE_SUSPENDED:\s*boolean\s*=\s*CAPTCHA_ENABLED/.test(src));
  check('sin variable de entorno nueva para el cambio de teléfono',
    /VITE_[A-Z_]*PHONE[A-Z_]*/.test(src) === false);
  const env = read('.env.example');
  check('.env.example con VITE_TURNSTILE_SITE_KEY (placeholder vacío)', /VITE_TURNSTILE_SITE_KEY=\s*$/m.test(env));
  check('.env.example sin valor real de site key', /VITE_TURNSTILE_SITE_KEY=\S/.test(env) === false);
}

// ─── 3. TurnstileWidget: Managed, reset, expiración/error, sin persistir token ─
{
  const src = read('src/components/TurnstileWidget.tsx');
  check('usa la API de Turnstile (render/reset)', /window\.turnstile/.test(src) && /reset:/.test(src));
  check('maneja expiración y error', /expired-callback/.test(src) && /error-callback/.test(src));
  check('solo se monta si CAPTCHA_ENABLED', /if \(!CAPTCHA_ENABLED\) return null/.test(src));
  check('token NO se persiste (sin localStorage/sessionStorage)', /localStorage|sessionStorage/.test(src) === false);
  check('token NO se registra (sin console.log del token)', /console\.log/.test(src) === false);
}

// ─── 4. auth.service: captchaToken en superficies + orden consent→otp ───
{
  const src = read('src/services/auth.service.ts');
  const send = between(src, 'export async function sendOtp', 'async function ensureProfile');
  check('sendOtp acepta captchaToken/requestId', /opts:\s*\{ captchaToken\?: string; requestId\?: string \}/.test(src));
  check('sendOtp: record_otp_consent ANTES de signInWithOtp',
    send.indexOf('recordOtpConsent(') >= 0 && send.indexOf('recordOtpConsent(') < send.indexOf('signInWithOtp('), true);
  check('sendOtp pasa captchaToken a signInWithOtp', /captchaToken:\s*opts\.captchaToken/.test(send));
  check('recordOtpConsent llama a la RPC record_otp_consent', /supabase\.rpc\('record_otp_consent'/.test(src));
  check('recordOtpConsent NO envía OTP/captcha token/ip', /p_otp|captcha_token|ip_address/.test(src) === false);
  check('signInWithPhonePassword acepta captchaToken', /signInWithPhonePassword\([\s\S]*?captchaToken\?: string/.test(src));
  check('signInWithEmail acepta captchaToken', /signInWithEmail\([\s\S]*?captchaToken\?: string/.test(src));
  check('requestPasswordReset acepta captchaToken', /requestPasswordReset\([\s\S]*?captchaToken\?: string/.test(src));
  check('resetPasswordForEmail recibe captchaToken', /resetPasswordForEmail\(cleanEmail,\s*\{[\s\S]*?captchaToken/.test(src));
  // No debilitado: verifyOtp intacto; contraseña obligatoria (P1C1) intacta.
  const verify = between(src, 'export async function verifyOtp', 'async function runPostLoginSideEffects');
  check("verifyOtp conserva type: 'sms'", /type:\s*'sms'/.test(verify));
  check('verifyOtpForPasswordSetup sigue presente (P1C1)', /export async function verifyOtpForPasswordSetup/.test(src));
  // Creación controlada intacta.
  check('OTP_SHOULD_CREATE_USER login=false/booking=true/claim=true',
    /login:\s*false/.test(src) && /booking:\s*true/.test(src) && /claim:\s*true/.test(src));
}

// ─── 5. LoginModal: consentimiento visible + guard + captcha + reset + reenvío ─
{
  const src = read('src/pages/doctor-detail/components/LoginModal.tsx');
  check('importa OtpConsentNotice y TurnstileWidget', /OtpConsentNotice/.test(src) && /TurnstileWidget/.test(src));
  check('muestra OtpConsentNotice (consentimiento visible)', /<OtpConsentNotice/.test(src));
  check('guard captchaBlock antes de enviar', /const cb = captchaBlock\(\);\s*if \(cb\) \{ setError\(cb\); return; \}/.test(src));
  check('sendOtp con captchaToken (código y reenvío)', (src.match(/sendOtp\(fullPhone, context, \{ captchaToken: captchaToken \?\? undefined \}\)/g) || []).length >= 2);
  check('reset del captcha tras cada intento (resetCaptcha en finally)', (src.match(/resetCaptcha\(\)/g) || []).length >= 4);
  check('captchaToken solo en memoria (sin localStorage)', /localStorage\.setItem\([^)]*captcha/i.test(src) === false);
  check('handleResendOtp con guard captcha (token fresco)', /const handleResendOtp[\s\S]*?captchaBlock\(\)/.test(src));
}

// ─── 6. ClaimProfileModal: consentimiento + captcha en el envío ───
{
  const src = read('src/pages/doctor-detail/components/ClaimProfileModal.tsx');
  check('muestra OtpConsentNotice', /<OtpConsentNotice/.test(src));
  check('guard captcha antes de enviar', /const cb = captchaBlock\(\);\s*if \(cb\) \{ setGenericError\(cb\); return; \}/.test(src));
  check("sendOtp('claim') con captchaToken", /sendOtp\(fullPhone, 'claim', \{ captchaToken: captchaToken \?\? undefined \}\)/.test(src));
  check('reset del captcha tras el intento', /resetCaptcha\(\)/.test(src));
  check('claim médico sigue conectado (verifyOtp + claimDoctorProfile)', /verifyOtp\(fullPhone, otpCode\)/.test(src) && /claimDoctorProfile\(\{/.test(src));
}

// ─── 7. ChangePhoneModal: suspensión ATADA al CAPTCHA ───
{
  const src = read('src/components/ChangePhoneModal.tsx');
  check('importa PHONE_CHANGE_SUSPENDED', /PHONE_CHANGE_SUSPENDED/.test(src));
  check('early return con el mensaje de suspensión', /if \(PHONE_CHANGE_SUSPENDED\) \{[\s\S]*PHONE_CHANGE_SUSPENDED_MESSAGE/.test(src));
  // (3) Con la suspensión activa NO se alcanza updateUser: guard al inicio de
  //     sendCode y de resend, ANTES de la llamada.
  check('guard en sendCode y resend (no updateUser)', (src.match(/if \(PHONE_CHANGE_SUSPENDED\) return;/g) || []).length >= 2);
  const sendBody = between(src, 'const sendCode = async', 'const verify');
  check('el guard precede a updateUser en sendCode',
    sendBody.indexOf('if (PHONE_CHANGE_SUSPENDED) return;') >= 0 &&
    sendBody.indexOf('if (PHONE_CHANGE_SUSPENDED) return;') < sendBody.indexOf('updateUser({ phone'), true);
  check('código de updateUser NO eliminado (se conserva)', /supabase\.auth\.updateUser\(\{ phone/.test(src));
}

// ─── 7b. Comportamiento REAL de la bandera con CAPTCHA off/on ───
// Se transpila el módulo REAL dos veces (esbuild --define) y se lee el valor
// efectivo: prueba conductual, no textual.
{
  const evalFlags = async (captchaEnabled, siteKey) => {
    const f = path.join(os.tmpdir(), `authFlags-${captchaEnabled}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
    execFileSync(process.execPath, [
      esbuildBin, 'src/lib/authFlags.ts', '--format=esm',
      `--define:import.meta.env.VITE_CAPTCHA_ENABLED=${JSON.stringify(captchaEnabled)}`,
      `--define:import.meta.env.VITE_TURNSTILE_SITE_KEY=${JSON.stringify(siteKey)}`,
      `--outfile=${f}`,
    ], { stdio: 'pipe' });
    const mod = await import(pathToFileURL(f).href);
    try { fs.unlinkSync(f); } catch { /* tmp */ }
    return mod;
  };

  // (1) CAPTCHA OFF (estado actual del despliegue) → cambio de teléfono DISPONIBLE.
  const off = await evalFlags('', '');
  check('CAPTCHA off → CAPTCHA_ENABLED = false', off.CAPTCHA_ENABLED, false);
  check('CAPTCHA off → cambio de teléfono NO suspendido', off.PHONE_CHANGE_SUSPENDED, false);
  check('CAPTCHA off → no se exige captcha', off.captchaRequired(), false);

  // (2)(4) CAPTCHA ON → suspensión AUTOMÁTICA, sin variable adicional.
  const on = await evalFlags('true', 'test-site-key');
  check('CAPTCHA on → CAPTCHA_ENABLED = true', on.CAPTCHA_ENABLED, true);
  check('CAPTCHA on → cambio de teléfono SUSPENDIDO (automático)', on.PHONE_CHANGE_SUSPENDED, true);
  check('CAPTCHA on → se exige captcha', on.captchaRequired(), true);

  // Fail-closed sigue vigente: CAPTCHA on sin Site Key.
  const onNoKey = await evalFlags('true', '');
  check('CAPTCHA on sin Site Key → mal configurado (fail-closed)', onNoKey.captchaMisconfigured(), true);
  check('CAPTCHA off sin Site Key → NO bloquea', off.captchaMisconfigured(), false);

  // El mensaje visible es el aprobado.
  check('mensaje de suspensión exacto',
    on.PHONE_CHANGE_SUSPENDED_MESSAGE, 'El cambio de teléfono está temporalmente no disponible.');
}

// ─── 8. Migración/hook intactos (Auth Hook, s7_65/66/67) ───
{
  let base = 'main';
  try { execFileSync('git', ['rev-parse', '--verify', 'main'], { stdio: 'pipe' }); } catch { base = 'HEAD'; }
  const changed = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  check('sin cambios en s7_65/66/67 (hook/intents)', changed.filter((f) => /s7_6[567]/.test(f)).length, 0);
  check('única migración nueva = s7_69', changed.filter((f) => f.startsWith('migrations/')).every((f) => /s7_69/.test(f)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-auth-p1d2: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
