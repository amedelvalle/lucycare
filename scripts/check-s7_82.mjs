#!/usr/bin/env node
/**
 * check-s7_82.mjs — DOCTOR-OWNER-NOTIFICATIONS-P0 · despertador de la outbox
 *
 * Guardas ESTÁTICAS sobre `s7_82`, su rollback y el procedimiento de Vault.
 * No toca la base, ni la red, ni envía correo.
 *
 * Lo que persigue, en orden de importancia:
 *   1. Que el secreto NO esté en el archivo, en ninguna forma.
 *   2. Que el despertador sea BEST-EFFORT: ningún fallo puede revertir el
 *      INSERT de la outbox.
 *   3. Que sea UN trigger AFTER INSERT FOR EACH ROW, y nada más.
 *   4. Que no toque s7_80, s7_81, Auth, Twilio, SMTP ni otras funciones.
 *
 *   node scripts/check-s7_82.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = 'migrations/s7_82_doctor_notification_wakeup.sql';
const RB = 'docs/rollbacks/s7_82_rollback.sql';
const GUIA = 'docs/OWNER_S7_80_APPLY.md';

const URL_ESPERADA = 'https://kvrsfmzlrmmmavillpuj.supabase.co/functions/v1/notify-owner-doctor-events';
const NOMBRE_SECRETO = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}${d ? `\n         ${d}` : ''}`); }
};

// Normalización a LF: con core.autocrlf=true los .sql quedan con CRLF y las
// anclas multilínea dejarían de casar (la deuda de check-s7_76).
const read = (p) => {
  const f = resolve(ROOT, p);
  if (!existsSync(f)) { console.error(`\nNo existe ${p}`); process.exit(1); }
  return readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
};
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const mig = read(MIG), rb = read(RB), guia = read(GUIA);
// La guía va justificada a 79 columnas, así que una frase se parte en varias
// líneas; y dentro de un blockquote cada línea empieza por `> `. Sin quitar
// ambos, cualquier ancla multipalabra sería un FAIL del instrumento y no del
// producto — ya pasó una vez en este archivo.
const guiaPlano = guia.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ');
const exMig = sinComentarios(mig);

/** Cuerpo de la función del despertador, sin las guardas POST. */
const cuerpo = (() => {
  const a = exMig.indexOf('CREATE OR REPLACE FUNCTION public._notify_owner_wakeup_fn()');
  const b = exMig.indexOf('$wake$;', a);
  return a < 0 || b < 0 ? '' : exMig.slice(a, b);
})();

console.log('\ncheck-s7_82 — despertador de la outbox\n');

// ─── 0 · Control de sanidad ─────────────────────────────────
console.log('0. Control de sanidad del instrumento');
check('CONTROL: la migración se leyó entera', mig.length > 4000);
check('CONTROL: el cuerpo del despertador se extrajo', cuerpo.length > 400);
check('CONTROL: quitar comentarios no vació el SQL', exMig.includes('CREATE TRIGGER trg_notify_owner_wakeup'));
check('CONTROL: el rollback se leyó', rb.length > 1000);

// ─── 1 · EL SECRETO NO ESTÁ AQUÍ ────────────────────────────
console.log('\n1. Ausencia del secreto (lo que más importa)');
check('lee el secreto desde Vault', cuerpo.includes('vault.decrypted_secrets'));
check('referencia el secreto por NOMBRE', cuerpo.includes(NOMBRE_SECRETO));
// Un literal entrecomillado de 40+ caracteres base64url tendría la forma del
// secreto (43). El NOMBRE son 34, así que no dispara este guard.
check('sin literales con forma de secreto (40+ base64url)', !/'[A-Za-z0-9_-]{40,}'/.test(mig));
// El control se CONSTRUYE en runtime en vez de escribirse como literal: un
// literal con forma de secreto en este archivo sería exactamente lo que el
// check prohíbe, y ensuciaría cualquier barrido futuro del repositorio.
const senueloValor = 'aB3-_xY9'.repeat(6);            // 48 caracteres base64url
const senuelo = `v := '${senueloValor}';`;
check('A/B: ese regex SÍ detectaría uno real (control)', /'[A-Za-z0-9_-]{40,}'/.test(senuelo));
check('CONTROL: el señuelo supera el umbral de 40', senueloValor.length >= 40);
check('el nombre del secreto NO dispara el guard (34 chars)', !/'[A-Za-z0-9_-]{40,}'/.test(`'${NOMBRE_SECRETO}'`));
check('no usa SQLERRM (podría arrastrar argumentos)', !cuerpo.includes('SQLERRM'));
check('el WARNING emite SQLSTATE', cuerpo.includes('SQLSTATE'));
check('no hay Authorization ni apikey', !/Authorization|apikey|sb_publishable_|sb_secret_/i.test(exMig));
check('no hay service_role en la llamada', !cuerpo.includes('service_role'));
check('POST verifica la ausencia de secretos embebidos', /POST falló: hay un literal con forma de secreto/.test(mig));
check('POST prohíbe SQLERRM', /POST falló: el WARNING usa SQLERRM/.test(mig));

// ⚠️ El POST mide sobre `prosrc`, que INCLUYE los comentarios. La primera
// versión medía el crudo y abortaba con «el WARNING usa SQLERRM» por culpa de
// su propio comentario: la guarda se disparaba con su propia advertencia y la
// migración no podía aplicarse. Ahora normaliza igual que este check.
console.log('\n1b. El POST mide CÓDIGO EJECUTABLE, no comentarios');
const post = mig.slice(mig.indexOf('-- ─── 3. POST'));
check('el POST calcula el cuerpo sin comentarios',
  /v_exec := regexp_replace\(v_src, '--\[\^\\n\]\*', '', 'g'\);/.test(post));
check('la prohibición de SQLERRM se mide sobre v_exec', /position\('SQLERRM' in v_exec\)/.test(post));
check('...y NO sobre el prosrc crudo', !/position\('SQLERRM' in v_src\)/.test(post));
check('el literal-con-forma-de-secreto se mide sobre v_exec', /v_exec ~ '''\[A-Za-z0-9_-\]\{40,\}'''/.test(post));
check('la prohibición de net.http_get se mide sobre v_exec', /position\('net\.http_get' in v_exec\)/.test(post));
// Acotado a la sección que inspecciona el WAKEUP. Las guardas de 3.6 miden
// `prosrc` de OTRAS funciones (claim_batch, claim_doctor_profile) y ahí `v_src`
// es correcto: se verificó que todas las cadenas que buscan están en código
// ejecutable, no solo en comentarios, así que no arrastran este defecto.
const postWakeup = post.slice(
  post.indexOf("'public._notify_owner_wakeup_fn()'::regprocedure"),
  post.indexOf('-- 3.5 Privilegios'),
);
check('CONTROL: la sección del wakeup se extrajo', postWakeup.length > 800);
check('ninguna comprobación del wakeup quedó sobre v_src crudo',
  (postWakeup.match(/in v_src\)/g) || []).length === 0);
check('CONTROL: el bloque POST se extrajo', post.length > 1500 && post.includes('v_exec :='));
check('mencionar SQLERRM en un comentario NO debe disparar la guarda',
  /position\('SQLERRM' in v_exec\)/.test(post) && /nunca SQLERRM/.test(mig));

// ─── 2 · Best-effort: el evento siempre gana ────────────────
console.log('\n2. No bloqueante');
check('bloque EXCEPTION WHEN OTHERS', /EXCEPTION WHEN OTHERS THEN/.test(cuerpo));
check('NO relanza la excepción', !/EXCEPTION WHEN OTHERS THEN[\s\S]*RAISE EXCEPTION/.test(cuerpo));
check('emite WARNING', /RAISE WARNING/.test(cuerpo));
check('devuelve NEW tras el bloque', /END;\s*\n\s*RETURN NEW;\s*\nEND;/.test(cuerpo));

// Que el bloque EXISTA no basta: tiene que ENVOLVER las dos operaciones que
// pueden fallar. Un EXCEPTION colocado después del `net.http_post` compilaría
// igual y no protegería nada.
//
// Y no es una red redundante: si el trigger propagara la excepción, la
// capturaría el EXCEPTION de `_enqueue_doctor_owner_notification`, cuya
// captura REVIERTE su subtransacción — y con ella el INSERT de la outbox. El
// aviso pasaría de "retrasado" a "PERDIDO". Este bloque es el único que
// sostiene «wakeup falla → fila durable».
// ⚠️ Medir solo el ORDEN de aparición no basta, y lo demostró el mutation
// test: al borrar el `BEGIN` interno, el `EXCEPTION` sigue en el texto y en la
// misma posición relativa, así que un check por índices lo dejaba pasar. Hay
// que medir el ANIDAMIENTO: tiene que existir un segundo `BEGIN` que abra
// antes de la lectura de Vault y que el `EXCEPTION` cierre.
const lineasCuerpo = cuerpo.split('\n').map((l) => l.trim());
const beginsEn = lineasCuerpo.reduce((a, l, i) => (l === 'BEGIN' ? [...a, i] : a), []);
const lnVault = lineasCuerpo.findIndex((l) => l.includes('vault.decrypted_secrets'));
const lnPost = lineasCuerpo.findIndex((l) => l.includes('net.http_post'));
const lnExc = lineasCuerpo.findIndex((l) => l.startsWith('EXCEPTION WHEN OTHERS'));

check('CONTROL: los tres puntos se localizaron', lnVault > 0 && lnPost > 0 && lnExc > 0);
check('hay EXACTAMENTE dos BEGIN: el de la función y el del catch', beginsEn.length === 2,
  `encontrados ${beginsEn.length}`);
check('el BEGIN interno abre ANTES de leer Vault', beginsEn.length === 2 && beginsEn[1] < lnVault);
check('el EXCEPTION cierra DESPUÉS de net.http_post', lnExc > lnPost && lnPost > lnVault);
check('A/B: quitar el BEGIN interno rompe el conteo (control)',
  ['BEGIN', 'BEGIN', 'x'].filter((l) => l === 'BEGIN').length === 2
  && ['BEGIN', 'x'].filter((l) => l === 'BEGIN').length !== 2);
check('la migración documenta que el catch interno NO es redundante',
  /el aviso se pierde PARA SIEMPRE|degrada "aviso retrasado" a "aviso perdido"/i.test(mig));
check('la migración explica que el de s7_80 protege OTRA cosa',
  /protege el EVENTO DE NEGOCIO; este protege la\s*\n?-- DURABILIDAD DEL AVISO/.test(mig)
  || /DURABILIDAD DEL AVISO/.test(mig));
check('maneja el secreto ausente sin llamar a HTTP',
  /IF v_secret IS NULL OR btrim\(v_secret\) = ''[\s\S]{0,320}RETURN NEW;/.test(cuerpo));
check('el camino del secreto ausente también avisa', /wakeup omitido: falta/.test(cuerpo));
check('POST verifica que sea best-effort', /POST falló: el wakeup no es best-effort/.test(mig));

// ─── 3 · Forma del trigger ──────────────────────────────────
console.log('\n3. Un solo trigger, AFTER INSERT FOR EACH ROW');
check('AFTER INSERT sobre la outbox', /CREATE TRIGGER trg_notify_owner_wakeup\s*\n\s*AFTER INSERT ON public\.doctor_owner_notifications/.test(exMig));
check('FOR EACH ROW', /FOR EACH ROW EXECUTE FUNCTION public\._notify_owner_wakeup_fn\(\)/.test(exMig));
check('NO cubre UPDATE (evitaría un bucle de despertares)', !/trg_notify_owner_wakeup[\s\S]{0,140}UPDATE/.test(exMig));
check('NO cubre DELETE', !/trg_notify_owner_wakeup[\s\S]{0,140}DELETE ON/.test(exMig));
check('un único CREATE TRIGGER', (exMig.match(/CREATE TRIGGER/g) || []).length === 1);
check('DROP TRIGGER IF EXISTS previo (idempotente)', /DROP TRIGGER IF EXISTS trg_notify_owner_wakeup/.test(exMig));
check('POST exige exactamente 1 trigger en la outbox', /POST falló: la outbox tiene % triggers/.test(mig));
check('POST exige la forma AFTER INSERT FOR EACH ROW', /POST falló: el trigger no es AFTER INSERT FOR EACH ROW/.test(mig));

// ─── 4 · La llamada HTTP ────────────────────────────────────
console.log('\n4. La llamada a pg_net');
check('invoca net.http_post schema-qualified', cuerpo.includes('net.http_post('));
check('URL exacta y literal', cuerpo.includes(URL_ESPERADA));
check('la URL NO se deriva del entorno', !/current_setting\('[^']*url/.test(cuerpo) && !/vercel\.app|localhost/.test(cuerpo));
check('payload mínimo', /body\s+:= '\{\}'::jsonb/.test(cuerpo));
check('timeout 5000 ms', /timeout_milliseconds := 5000/.test(cuerpo));
check('cabecera del secreto', /'X-Lucycare-Notify-Secret', v_secret/.test(cuerpo));
check('Content-Type: application/json', /'Content-Type', 'application\/json'/.test(cuerpo));
check('NO hay GET', !cuerpo.includes('net.http_get'));
check('PRE valida la firma exacta de net.http_post', /to_regprocedure\('net\.http_post\(text, jsonb, jsonb, jsonb, integer\)'\)/.test(mig));

// ─── 5 · Seguridad de la función ────────────────────────────
console.log('\n5. Privilegios y search_path');
check('SECURITY DEFINER', /LANGUAGE plpgsql SECURITY DEFINER/.test(exMig));
check('search_path fijado', /SET search_path = public/.test(exMig));
for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
  check(`REVOKE de ${rol}`, exMig.includes(`REVOKE ALL ON FUNCTION public._notify_owner_wakeup_fn() FROM ${rol};`));
}
check('NO se otorga a nadie', !/GRANT EXECUTE ON FUNCTION public\._notify_owner_wakeup_fn/.test(exMig));
check('POST verifica que no quedó otorgada', /POST falló: el wakeup quedó otorgado a algún rol/.test(mig));

// ─── 6 · Alcance: no toca nada más ──────────────────────────
console.log('\n6. Alcance');
check('NO crea ni altera tablas', !/CREATE TABLE|ALTER TABLE|DROP TABLE/i.test(exMig));
check('NO crea schemas', !/CREATE SCHEMA/i.test(exMig));
check('NO crea roles', !/CREATE (USER|ROLE)/i.test(exMig));
check('NO crea objetos en supabase_functions', !/CREATE[\s\S]{0,40}supabase_functions\./i.test(exMig));
check('NO instala extensiones', !/CREATE EXTENSION/i.test(exMig));
check('NO redefine el helper de encolado', !/CREATE OR REPLACE FUNCTION public\._enqueue/.test(exMig));
check('NO redefine claim_batch', !/CREATE OR REPLACE FUNCTION public\.notify_owner_claim_batch/.test(exMig));
check('NO redefine mark_result', !/CREATE OR REPLACE FUNCTION public\.notify_owner_mark_result/.test(exMig));
check('NO redefine claim_doctor_profile', !/CREATE OR REPLACE FUNCTION claim_doctor_profile/.test(exMig));
check('NO toca el trigger de afiliación', !/DROP TRIGGER IF EXISTS trg_notify_owner_affiliation/.test(exMig));
check('NO toca auth.users ni auth.', !/auth\./i.test(exMig));
check('NO toca Twilio, SMTP ni Turnstile', !/twilio|smtp|turnstile|captcha/i.test(exMig));
check('NO escribe en audit_log', !/INSERT INTO audit_log/i.test(exMig));
check('una sola CREATE OR REPLACE FUNCTION', (exMig.match(/CREATE OR REPLACE FUNCTION/g) || []).length === 1);
check('POST guarda s7_81 (subject_profile_id)', /POST falló: notify_owner_claim_batch se alteró/.test(mig));
check('POST guarda el enqueue del claim', /POST falló: claim_doctor_profile perdió el enqueue/.test(mig));
check('POST guarda el trigger de afiliación', /POST falló: se perdió el trigger de afiliación de s7_80/.test(mig));

// ─── 7 · PRE ────────────────────────────────────────────────
console.log('\n7. PRE');
check('aborta sin la outbox de s7_80', /PRE falló: no existe la outbox/.test(mig));
check('aborta sin pg_net', /PRE falló: pg_net no está instalada/.test(mig));
check('aborta sin la firma de net.http_post', /PRE falló: net\.http_post\(text,jsonb,jsonb,jsonb,integer\) no existe/.test(mig));
check('aborta sin Vault', /PRE falló: no existe Vault \(vault\.secrets \/ vault\.decrypted_secrets\)/.test(mig));
check('aborta si el secreto no está EXACTAMENTE una vez',
  /PRE falló: se esperaba EXACTAMENTE 1 secreto en Vault/.test(mig));
check('el PRE comprueba el secreto SIN descifrarlo',
  /SELECT count\(\*\) INTO v_n\s*\n\s*FROM vault\.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';/.test(mig));
check('el PRE NO usa decrypted_secrets', !/FROM vault\.decrypted_secrets/.test(mig.slice(0, mig.indexOf('-- ─── 1. El despertador'))));
check('aborta si s7_82 ya está aplicada', /PRE falló: _notify_owner_wakeup_fn ya existe/.test(mig));
check('la guarda de doble wakeup exige CERO triggers', /PRE falló: la outbox ya tiene % trigger\(s\)/.test(mig));
check('esa guarda nombra los triggers encontrados', /\[%\]\. Toda webhook es un/.test(mig));
check('documenta por qué toda webhook es un trigger', /Toda webhook es un\s*\n\s*--\s*trigger|TODA webhook es un\s*\n\s*-- trigger/.test(mig) || /Toda webhook es un/.test(mig));
check('aborta si claim_batch no es la de s7_81', /PRE falló: notify_owner_claim_batch no es la versión de s7_81/.test(mig));
check('aborta si la outbox ya tenía triggers', /PRE falló: la outbox ya tiene % trigger\(s\)/.test(mig));

// ─── 8 · Rollback ───────────────────────────────────────────
console.log('\n8. Rollback');
check('borra el trigger', rb.includes('DROP TRIGGER IF EXISTS trg_notify_owner_wakeup'));
check('borra la función', rb.includes('DROP FUNCTION IF EXISTS public._notify_owner_wakeup_fn()'));
check('NO borra la outbox', !/DROP TABLE/i.test(rb));
check('NO borra el helper ni las RPCs', !/DROP FUNCTION IF EXISTS public\.(_enqueue|notify_owner_claim_batch|notify_owner_mark_result)/.test(rb));
check('NO borra el secreto de Vault', !/DELETE FROM vault|vault\.delete/i.test(rb));
check('NO desinstala pg_net', !/DROP EXTENSION/i.test(rb));
check('POST comprueba que la outbox queda sin triggers', /ROLLBACK fallo: la outbox conserva/.test(rb));
check('POST comprueba que sobrevive s7_80/s7_81', /ROLLBACK fallo: desaparecio algo de s7_80\/s7_81/.test(rb));
check('POST comprueba el trigger de afiliación', /ROLLBACK fallo: se perdio el trigger de afiliacion de s7_80/.test(rb));
check('POST comprueba la auditoría de s7_21', /ROLLBACK fallo: se perdio el trigger de auditoria de s7_21/.test(rb));
check('advierte que sin wakeup nadie drena', /los eventos siguen encolandose, pero nadie los drena/.test(rb));

// ─── 9 · Guía: Vault y smoke ────────────────────────────────
console.log('\n9. Guía del owner');
// La carga es SOLO por Dashboard. `vault.create_secret` sigue apareciendo en
// la guía, pero dentro de la explicación de por qué NO se usa: un check por
// esa cadena a secas pasaría igual y no mediría nada.
check('la carga del secreto es por Dashboard', /Project Settings → Vault → Add new secret/.test(guiaPlano));
check('descarta explícitamente CLI y SQL', /Solo por Dashboard\. Ni CLI, ni SQL\./.test(guia));
check('explica por qué no por SQL (historial del editor)', /el SQL Editor \*\*guarda el historial\*\*/.test(guiaPlano));
check('explica por qué no por CLI (otro almacén y argv)', /es otro almacén, el de la Edge Function/.test(guiaPlano));
check('el nombre se escribe a mano, exacto', /Escribí el \*\*Name\*\* a mano, exacto/.test(guiaPlano));
check('documenta el punto ciego Vault vs Edge Function secret',
  /Nada en la base puede comprobar que el\s*valor de Vault \*\*coincida\*\*/.test(guiaPlano));
check('preflight de Vault por conteo, sin descifrar',
  /SELECT count\(\*\) FROM vault\.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';/.test(guia));
check('documenta esperado 0 antes y 1 después',
  /Esperado: \*\*`0`\*\*/.test(guia) && /Esperado: \*\*`1`\*\*/.test(guia));
check('prohíbe usar decrypted_secrets para comprobar existencia',
  /Nunca uses `vault\.decrypted_secrets` para comprobar/.test(guia.replace(/\s+/g, ' ')));
check('el smoke comprueba existencia con vault.secrets, no decrypted',
  /FROM vault\.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET'/.test(guia));
check('la guía ordena Vault ANTES de s7_82',
  guia.indexOf('Paso 7 — Cargar el secreto en Vault') < guia.indexOf('Paso 8 — Aplicar `s7_82`'));
check('la guía desaconseja aplicar con Vault vacío',
  /no se provoca a propósito en\s*\n?> producción|Vault ANTES de `s7_82`/.test(guia));
check('la guía NO sugiere correr el smoke con Vault vacío',
  !/Vale la pena correrlo \*\*las dos\s*\n?veces\*\*/.test(guia));
check('la guía NO contiene un secreto', !/'[A-Za-z0-9_-]{40,}'/.test(guia));
check('el nombre del secreto en Vault es el exacto', guia.includes(NOMBRE_SECRETO));
check('documenta el smoke transaccional de s7_82', /s7_82 SMOKE/.test(guia));
check('el smoke de s7_82 va en BEGIN…ROLLBACK', /BEGIN;[\s\S]*s7_82 SMOKE[\s\S]*ROLLBACK;/.test(guia));
check('explica por qué el smoke no hace HTTP real',
  /solo ve filas COMMITEADAS/.test(guiaPlano) && /no llega a salir ninguna petición/i.test(guiaPlano));
check('A/B: ese control detecta la frase partida en dos líneas (control)',
  /solo ve filas COMMITEADAS/.test('el worker **solo ve\nfilas COMMITEADAS**'.replace(/\s+/g, ' ')));

// ─── 10 · Numeración ────────────────────────────────────────
console.log('\n10. Numeración');
check('la migración es s7_82', existsSync(resolve(ROOT, MIG)));
check('s7_80 sigue existiendo', existsSync(resolve(ROOT, 'migrations/s7_80_doctor_owner_notifications.sql')));
check('s7_81 sigue existiendo', existsSync(resolve(ROOT, 'migrations/s7_81_notification_event_semantics.sql')));
check('el rollback de s7_82 existe', existsSync(resolve(ROOT, RB)));

console.log(`\n${pass}/${pass + fail} · ${fail === 0 ? 'PASS' : `${fail} FAIL`}\n`);
process.exit(fail === 0 ? 0 : 1);
