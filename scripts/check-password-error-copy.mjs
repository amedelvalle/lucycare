/**
 * check-password-error-copy.mjs — PASSWORD-ERROR-COPY-P0.
 *
 *   node scripts/check-password-error-copy.mjs
 *
 * Sin red, sin Supabase, sin service_role, sin datos. Dos partes:
 *
 *   A) FUNCIONAL — importa el módulo REAL `src/lib/passwordErrors.ts`
 *      (transpilado con el esbuild que ya trae Vite, mismo patrón que
 *      `check-auth-p1a-phone.mjs`) y corre la matriz señal → copy.
 *
 *   B) A/B DEL INSTRUMENTO — compara el `auth.service.ts` de trabajo contra
 *      el del commit anterior al frente. El bug tiene
 *      que REPRODUCIRSE en el anterior y estar ausente en el actual. Un check
 *      que solo pasa "después" no prueba nada.
 *
 * Alcance: SOLO copy de error de contraseña. No cubre OTP, login ni sesión.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')),
  'bin',
  'esbuild',
);
const outFile = path.join(os.tmpdir(), `passwordErrors-check-${Date.now()}.mjs`);
// `--bundle`: el módulo importa MIN_PASSWORD_LENGTH de `src/lib/password.ts`.
execFileSync(process.execPath, [
  esbuildBin,
  'src/lib/passwordErrors.ts',
  '--bundle',
  '--platform=neutral',
  '--format=esm',
  `--outfile=${outFile}`,
], { stdio: 'pipe' });

const {
  passwordErrorMessage,
  SAME_PASSWORD_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  RATE_LIMIT_MESSAGE,
  GENERIC_PASSWORD_MESSAGE,
} = await import(pathToFileURL(outFile).href);

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};
const eq = (desc, got, expected) =>
  check(desc, got === expected, `obtuvo ${JSON.stringify(got)}`);

// Sin límite de palabra final a propósito: 'á' NO es carácter de palabra en
// JS, así que un \b tras la vocal acentuada nunca casa y la aserción quedaría
// vacua (pasaría siempre, incluso sobre texto en voseo).
const VOSEO = /(?:Probá|Refrescá|Solicitá|Intentá|Volvé|volvé|Ingresá|Esperá|Verificá)/;
const INGLES = /\b(password|should|error|invalid|expired|token)\b/i;

console.log('\ncheck-password-error-copy — PASSWORD-ERROR-COPY-P0\n');

// ─── A) matriz del módulo real ──────────────────────────────
console.log('  A) src/lib/passwordErrors.ts — señal → copy\n');

// El caso observado por el owner, por código y por texto del proveedor.
eq('code same_password', passwordErrorMessage({ code: 'same_password', status: 422 }), SAME_PASSWORD_MESSAGE);
eq(
  'texto crudo "New password should be different from the old password."',
  passwordErrorMessage({ status: 422, message: 'New password should be different from the old password.' }),
  SAME_PASSWORD_MESSAGE,
);
eq(
  'copy aprobado por el owner',
  SAME_PASSWORD_MESSAGE,
  'La nueva contraseña debe ser diferente de la contraseña anterior.',
);

eq('code weak_password', passwordErrorMessage({ code: 'weak_password', status: 422 }), WEAK_PASSWORD_MESSAGE);
eq(
  'texto "Password should be at least 6 characters."',
  passwordErrorMessage({ status: 422, message: 'Password should be at least 6 characters.' }),
  WEAK_PASSWORD_MESSAGE,
);
eq('422 sin código → política', passwordErrorMessage({ status: 422 }), WEAK_PASSWORD_MESSAGE);

eq('401 → sesión', passwordErrorMessage({ status: 401 }), SESSION_EXPIRED_MESSAGE);
eq('403 → sesión', passwordErrorMessage({ status: 403 }), SESSION_EXPIRED_MESSAGE);
eq('code session_not_found', passwordErrorMessage({ code: 'session_not_found' }), SESSION_EXPIRED_MESSAGE);

eq('429 → rate limit', passwordErrorMessage({ status: 429 }), RATE_LIMIT_MESSAGE);
eq('code over_request_rate_limit', passwordErrorMessage({ code: 'over_request_rate_limit' }), RATE_LIMIT_MESSAGE);

eq('sin señales → genérico', passwordErrorMessage({}), GENERIC_PASSWORD_MESSAGE);
eq('500 desconocido → genérico', passwordErrorMessage({ status: 500, message: 'boom' }), GENERIC_PASSWORD_MESSAGE);

// Precedencia: same_password gana sobre el 422 genérico. Ese era el segundo
// defecto de copy: `setPasswordWithFetch` reportaba "débil" una repetida.
eq(
  'same_password + 422 → NO cae en "débil"',
  passwordErrorMessage({ code: 'same_password', status: 422, message: 'whatever' }),
  SAME_PASSWORD_MESSAGE,
);

// Control del instrumento: el detector de voseo tiene que detectar voseo.
check('el detector de voseo NO es vacuo', VOSEO.test('Probá de nuevo.') && VOSEO.test('Refrescá la página.'));

const ALL = [
  SAME_PASSWORD_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  RATE_LIMIT_MESSAGE,
  GENERIC_PASSWORD_MESSAGE,
];
check('ningún copy en voseo', !ALL.some((m) => VOSEO.test(m)));
check('ningún copy con jerga en inglés', !ALL.some((m) => INGLES.test(m)));
check('todo copy termina en punto', ALL.every((m) => m.trim().endsWith('.')));

// ─── B) A/B contra el código anterior ───────────────────────
console.log('\n  B) A/B — el bug debe reproducirse en el código anterior y estar ausente ahora\n');

const FILE = 'src/services/auth.service.ts';
const actual = fs.readFileSync(FILE, 'utf8');

// La referencia del A/B es el código ANTERIOR AL FRENTE. No sirve `HEAD` (una
// vez commiteado el fix ya es el código corregido) ni el merge-base con
// `main` (después del merge, `main` YA contiene el fix y la base sería él
// mismo). Se ancla al commit que introdujo `passwordErrors.ts`: su padre es,
// por definición, el estado anterior — y eso vale igual en la rama, en `main`
// post-merge y en cualquier clon futuro.
const MODULO = 'src/lib/passwordErrors.ts';
const baseline = () => {
  try {
    const introduccion = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--format=%H', '--', MODULO],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop(); // el más antiguo: la primera vez que apareció el módulo
    if (introduccion) {
      return execFileSync('git', ['rev-parse', `${introduccion}^`], { encoding: 'utf8' }).trim();
    }
  } catch {
    /* módulo aún sin commitear: cae al merge-base */
  }
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['merge-base', 'HEAD', ref], { encoding: 'utf8' }).trim();
    } catch {
      /* ref ausente: probar la siguiente */
    }
  }
  return '';
};

const base = baseline();
let anterior = '';
if (base) {
  try {
    anterior = execFileSync('git', ['show', `${base}:${FILE}`], { encoding: 'utf8' });
    console.log(`  referencia ANTERIOR: ${base.slice(0, 7)} (anterior al frente)\n`);
  } catch {
    /* archivo ausente en la base */
  }
}
if (!anterior) console.log('  ⚠️  no se pudo resolver el código anterior; el A/B se omite');

// Acotado a `setPasswordFromRecovery`: otros flujos (OTP) también devuelven
// `error.message` y quedan FUERA del alcance de este frente.
const recoveryBody = (src) => {
  const i = src.indexOf('export async function setPasswordFromRecovery');
  if (i < 0) return '';
  const j = src.indexOf('\nexport ', i + 1);
  return src.slice(i, j < 0 ? undefined : j);
};
const FUGA = /error:\s*error\.message/;

if (anterior) {
  check('ANTERIOR: `setPasswordFromRecovery` localizada', recoveryBody(anterior).length > 0);
  check('ANTERIOR: la fuga `error.message` se reproduce', FUGA.test(recoveryBody(anterior)));
  check('ANTERIOR: el copy de contraseña estaba en voseo', VOSEO.test(anterior));
}
check('ACTUAL: `setPasswordFromRecovery` localizada', recoveryBody(actual).length > 0);
check('ACTUAL: sin `error.message` crudo en el flujo de recuperación', !FUGA.test(recoveryBody(actual)));
check('ACTUAL: usa el helper único `passwordErrorMessage`', actual.includes('passwordErrorMessage('));
check(
  'ACTUAL: los dos caminos (recuperación y creación) usan el helper',
  (actual.match(/passwordErrorMessage\(\{/g) || []).length === 2,
);

// El 422 ya no puede colapsar todo en "requisitos mínimos".
check(
  'ACTUAL: el 422 ya no fuerza el mensaje de contraseña débil',
  !/status === 422[\s\S]{0,200}requisitos mínimos/.test(actual),
);

// Las cadenas de contraseña de auth.service quedan en tuteo.
const CADENAS_PWD = actual
  .split('\n')
  .filter((l) => /error: '.*(contraseña|sesión|link de recuperación|operación)/.test(l));
check(`ACTUAL: ${CADENAS_PWD.length} cadenas de contraseña localizadas`, CADENAS_PWD.length >= 4);
check('ACTUAL: ninguna de esas cadenas en voseo', !CADENAS_PWD.some((l) => VOSEO.test(l)));

// La página de recuperación tampoco muestra el mensaje crudo.
const PAGE = 'src/pages/reset-password/ResetPasswordPage.tsx';
const page = fs.readFileSync(PAGE, 'utf8');
check(
  'ACTUAL: ResetPasswordPage no imprime `err.message`',
  !/setError\(err instanceof Error \? err\.message/.test(page),
);
check('ACTUAL: ResetPasswordPage usa el copy genérico del helper', page.includes('GENERIC_PASSWORD_MESSAGE'));

// ─── Guardián de copy de /reset-password ────────────────────
// Se revisa el archivo COMPLETO sin sus comentarios (los comentarios sí
// pueden decir "link": describen el mecanismo, no son user-facing).
const sinComentarios = page
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n');

// Voseo: la lista explícita NO alcanza — la corrida anterior dio un falso PASS
// porque "Confirmá" y "Repetí" no estaban en ella. Se agrega una heurística
// sobre la terminación verbal, con allowlist de palabras que no son voseo.
const NO_VOSEO = new Set([
  'está', 'acá', 'aquí', 'ahí', 'allí', 'así', 'aún', 'día', 'país', 'café',
  'qué', 'porqué', 'sesión', 'después', 'además', 'atrás', 'través', 'inglés',
  'más', 'menú', 'algún', 'ningún',
]);
// Se tokeniza a mano: el `\b` de JS no considera las vocales acentuadas como
// caracteres de palabra, así que dentro de "Después" reconocía "Despué" como
// palabra completa y producía falsos positivos.
const LETRAS = /[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/;
const TERMINACION_VOSEO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}(?:á|é|í|ás|és|ís)$/;
const sospechosasVoseo = (texto) =>
  texto
    .split(LETRAS)
    .filter((w) => TERMINACION_VOSEO.test(w) && !NO_VOSEO.has(w.toLowerCase()));

const hallazgos = (etiqueta, regex) =>
  sinComentarios
    .split('\n')
    .filter((l) => regex.test(l))
    .map((l) => `${etiqueta}: ${l.trim().slice(0, 80)}`);

const VOSEO_HALLAZGOS = [
  ...sinComentarios.split('\n').flatMap((l) => sospechosasVoseo(l).map((w) => `voseo?: ${w}`)),
  ...hallazgos('voseo', VOSEO),
];
check(
  'ACTUAL: /reset-password sin voseo en ninguna cadena user-facing',
  VOSEO_HALLAZGOS.length === 0,
  VOSEO_HALLAZGOS.join(' | '),
);

const LOGUEADO = hallazgos('logueado', /\bloguead[oa]s?\b/i);
check('ACTUAL: /reset-password sin "logueado/logueada"', LOGUEADO.length === 0, LOGUEADO.join(' | '));

const LINK = hallazgos('link', /\blinks?\b/i);
check(
  'ACTUAL: /reset-password sin "link" como sustantivo visible (se dice "enlace")',
  LINK.length === 0,
  LINK.join(' | '),
);

// Control del instrumento: los tres guardianes tienen que detectar lo suyo.
check(
  'los tres guardianes de copy NO son vacuos',
  sospechosasVoseo('Confirmá la contraseña y repetí').length === 2 &&
    /\bloguead[oa]s?\b/i.test('quedas logueado') &&
    /\blinks?\b/i.test('El link expiró'),
);

// A/B de los guardianes contra la página ANTERIOR, que sí tenía las tres
// cosas: "Solicitá"/"Elegí"/"Confirmá"/"Repetí", "quedás logueado" y "link".
if (base) {
  let pageAnterior = '';
  try {
    pageAnterior = execFileSync('git', ['show', `${base}:${PAGE}`], { encoding: 'utf8' });
  } catch {
    /* la página no existía en la base */
  }
  if (pageAnterior) {
    const anteriorSinComentarios = pageAnterior
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    check('ANTERIOR: el guardián de voseo dispara', sospechosasVoseo(anteriorSinComentarios).length > 0);
    check('ANTERIOR: el guardián de "logueado" dispara', /\bloguead[oa]s?\b/i.test(anteriorSinComentarios));
    check('ANTERIOR: el guardián de "link" dispara', /\blinks?\b/i.test(anteriorSinComentarios));
  }
}

// El copy de sesión expirada sirve a los DOS caminos (creación y
// recuperación), así que no puede afirmar que se está "creando" la contraseña.
check(
  'ACTUAL: el mensaje de sesión es neutral entre creación y recuperación',
  !/crear la contraseña/.test(SESSION_EXPIRED_MESSAGE),
);

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
fs.rmSync(outFile, { force: true });
process.exit(fail === 0 ? 0 : 1);
