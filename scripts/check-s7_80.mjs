#!/usr/bin/env node
/**
 * check-s7_80.mjs — DOCTOR-OWNER-NOTIFICATIONS-P0
 *
 * Tres capas, y la tercera es la que de verdad prueba algo:
 *   1. Guardas ESTÁTICAS sobre la migración, el rollback, la Edge Function y
 *      la guía de rollout.
 *   2. A/B ESTRUCTURAL: quitando el bloque sentinelado de s7_80, el cuerpo de
 *      `claim_doctor_profile` debe ser byte-idéntico al de s7_64.
 *   3. Pruebas CONDUCTUALES: transpila `render.ts` con esbuild y lo EJECUTA
 *      sobre casos sintéticos. No lee texto: mide comportamiento.
 *
 * No toca la base, ni la red, ni envía correo.
 *
 *   node scripts/check-s7_80.mjs
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIG = 'migrations/s7_80_doctor_owner_notifications.sql';
const MIG64 = 'migrations/s7_64_credentials_logical_retirement.sql';
const RB = 'docs/rollbacks/s7_80_rollback.sql';
const FN = 'supabase/functions/notify-owner-doctor-events/index.ts';
const RENDER = 'supabase/functions/notify-owner-doctor-events/render.ts';
const GUIA = 'docs/OWNER_S7_80_APPLY.md';

let pass = 0, fail = 0;
const check = (label, ok) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};
const eq = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`);
  }
};

/**
 * Lectura NORMALIZADA a LF.
 *
 * `core.autocrlf=true` deja los .sql con CRLF en el working tree; los regex
 * que anclan en `;\n` no casan con `;\r\n` y el check "falla" sin que nada
 * esté mal. Es exactamente la deuda que arrastra check-s7_76 (329/353). Aquí
 * se normaliza en la puerta de entrada para que no pueda repetirse.
 */
const read = (p) => {
  const f = resolve(ROOT, p);
  if (!existsSync(f)) { console.error(`\nNo existe ${p}`); process.exit(1); }
  return readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
};

/** SQL sin comentarios: las guardas POST nombran a propósito lo prohibido. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const mig = read(MIG), mig64 = read(MIG64), rb = read(RB), fn = read(FN), render = read(RENDER);
const guia = read(GUIA);
const exMig = sinComentarios(mig);

/** Cuerpo de una función `$tag$ … $tag$;` dentro de un SQL. */
const cuerpoFn = (txt, firma, tag) => {
  const a = txt.indexOf(firma);
  if (a < 0) return '';
  const b = txt.indexOf(`$${tag}$;`, a);
  return b < 0 ? '' : txt.slice(a, b);
};

/** La función del claim, como array de líneas, desde un SQL cualquiera. */
const lineasClaim = (txt) => {
  const l = txt.split('\n');
  const a = l.findIndex((x) => x.startsWith('CREATE OR REPLACE FUNCTION claim_doctor_profile('));
  if (a < 0) return [];
  let b = -1;
  for (let i = a; i < l.length; i++) if (l[i] === '$$;') { b = i; break; }
  return b < 0 ? [] : l.slice(a, b + 1);
};

console.log('\ncheck-s7_80 — aviso al owner: afiliación y claim\n');

// ─── 0 · CONTROL DE SANIDAD ─────────────────────────────────
// Si la maquinaria de extracción está rota, TODO lo demás daría "ausente" y
// parecería un problema del producto. Estas cuatro deben pasar siempre.
console.log('0. Control de sanidad del instrumento');
check('CONTROL: la migración se leyó y no está vacía', mig.length > 3000);
check('CONTROL: s7_64 expone el claim', lineasClaim(mig64).length > 100);
check('CONTROL: s7_80 expone el claim', lineasClaim(mig).length > 100);
check('CONTROL: quitar comentarios no vació el SQL', exMig.includes('CREATE TABLE IF NOT EXISTS public.doctor_owner_notifications'));

// ─── 1 · A/B estructural del claim ──────────────────────────
console.log('\n1. A/B: el claim es s7_64 más UN bloque');
const c64 = lineasClaim(mig64);
const c80 = lineasClaim(mig);
const ini = c80.findIndex((x) => x.trim() === '-- >>> s7_80 ENQUEUE BEGIN');
const finB = c80.findIndex((x) => x.trim() === '-- <<< s7_80 ENQUEUE END');
check('el bloque está sentinelado (BEGIN)', ini >= 0);
check('el bloque está sentinelado (END)', finB > ini);
const desnudo = ini >= 0 && finB > ini ? [...c80.slice(0, ini), ...c80.slice(finB + 2)] : [];
check('A/B: sin el bloque, el cuerpo es IDÉNTICO al de s7_64', desnudo.join('\n') === c64.join('\n'));
check('A/B: con el bloque NO lo es (el instrumento discrimina)', c80.join('\n') !== c64.join('\n'));
eq('el bloque añade exactamente 14 líneas', c80.length - c64.length, 14);

// Delimitadores intactos. Regresión real de este frente: construir el archivo
// con String.replace convirtió `AS $$` en `AS $` y `$$;` en `$;`, porque la
// CADENA DE REEMPLAZO interpreta `$$` como un `$` literal. El SQL quedaba
// roto y el archivo se escribía sin error.
console.log('\n1b. Delimitadores de la función (regresión conocida)');
check('s7_80: el claim abre con `AS $$`', c80.includes('AS $$'));
check('s7_80: el claim cierra con `$$;`', c80[c80.length - 1] === '$$;');
check('s7_80: no quedó ningún `AS $` suelto', !c80.some((l) => l === 'AS $'));
check('s7_80: no quedó ningún `$;` suelto', !c80.some((l) => l === '$;'));
check('rollback: el claim abre con `AS $$`', lineasClaim(rb).includes('AS $$'));
check('rollback: el claim cierra con `$$;`', lineasClaim(rb).slice(-1)[0] === '$$;');

// Balance de dollar-quoting en TODO el archivo. Un delimitador impar deja el
// SQL sintácticamente roto y el error solo aparecería al pegarlo en el SQL
// Editor. Cada etiqueta debe aparecer un número PAR de veces.
const balance = (txt, nombre) => {
  const etiquetas = [...txt.matchAll(/\$([a-z]*)\$/g)].map((m) => m[1]);
  const cuenta = etiquetas.reduce((a, t) => { a[t] = (a[t] ?? 0) + 1; return a; }, {});
  const impares = Object.entries(cuenta).filter(([, n]) => n % 2 !== 0);
  check(`${nombre}: delimitadores $tag$ balanceados`, impares.length === 0);
  return Object.keys(cuenta);
};
const tagsMig = balance(mig, 's7_80');
balance(rb, 'rollback');
check('CONTROL: se detectaron las etiquetas esperadas', ['', 'pre', 'enq', 'aff', 'batch', 'mark', 'post'].every((t) => tagsMig.includes(t)));

// ─── 2 · El punto de disparo ────────────────────────────────
console.log('\n2. Dónde se encola cada evento');
check('el claim encola tras la auditoría', /INSERT INTO audit_log[\s\S]*_enqueue_doctor_owner_notification/.test(c80.join('\n')));
check('el claim encola ANTES del RETURN', c80.findIndex((l) => l.includes('_enqueue_doctor_owner_notification')) < c80.findIndex((l) => l === '  RETURN jsonb_build_object('));
check('encola con doctor_profile_claimed', c80.join('\n').includes("'doctor_profile_claimed', NULL, p_doctor_id, v_user_id"));
eq('el claim encola UNA sola vez', (c80.join('\n').match(/PERFORM public\._enqueue_doctor_owner_notification/g) || []).length, 1);
check('afiliación: trigger AFTER INSERT', /CREATE TRIGGER trg_notify_owner_affiliation\s+AFTER INSERT ON public\.doctor_affiliation_requests/.test(exMig));
check('afiliación: el trigger NO cubre UPDATE', !/trg_notify_owner_affiliation[\s\S]{0,120}UPDATE/.test(exMig));
check('afiliación: el trigger NO cubre DELETE', !/trg_notify_owner_affiliation[\s\S]{0,120}DELETE ON/.test(exMig));
check('NO hay trigger sobre doctors (no distinguiría del cambio admin)', !/CREATE TRIGGER[\s\S]{0,80}ON public\.doctors/.test(exMig));
check('NO se toca submit_affiliation_request', !exMig.includes('CREATE OR REPLACE FUNCTION submit_affiliation_request'));
check('NO se toca admin_list_doctors', !exMig.includes('CREATE OR REPLACE FUNCTION public.admin_list_doctors'));
check('NO se toca admin_export_doctors', !exMig.includes('CREATE OR REPLACE FUNCTION public.admin_export_doctors'));

// ─── 3 · No bloqueo ─────────────────────────────────────────
console.log('\n3. El evento de negocio siempre gana');
const enq = cuerpoFn(exMig, 'CREATE OR REPLACE FUNCTION public._enqueue_doctor_owner_notification', 'enq');
check('el helper existe', enq.length > 0);
check('el helper tiene bloque EXCEPTION WHEN OTHERS', /EXCEPTION WHEN OTHERS THEN/.test(enq));
check('el helper NO relanza la excepción', !/EXCEPTION WHEN OTHERS THEN[\s\S]*RAISE EXCEPTION/.test(enq));
check('el helper deja rastro (RAISE WARNING)', /RAISE WARNING/.test(enq));
check('el helper usa ON CONFLICT DO NOTHING', /ON CONFLICT \(event_type, dedupe_key\) DO NOTHING/.test(enq));

// ─── 4 · Idempotencia ───────────────────────────────────────
console.log('\n4. Claves de deduplicación');
check('afiliación deduplica por request_id', /IF p_event_type = 'affiliation_submitted' THEN\s*\n\s*v_dedupe := p_request_id::text;/.test(enq));
check('claim deduplica por el PROPIO id (evento nuevo cada vez)', /ELSE\s*\n\s*v_dedupe := v_id::text;/.test(enq));
check('el claim NO deduplica por doctor_id', !/v_dedupe := p_doctor_id::text/.test(enq));
check('el claim NO deduplica por doctor_id + profile_id', !/v_dedupe := .*p_doctor_id.*p_profile_id/.test(enq));
check('NO se deduplica por nombre/teléfono/correo', !/v_dedupe := .*(full_name|phone|email)/.test(enq));
check('índice único (event_type, dedupe_key)', /CREATE UNIQUE INDEX IF NOT EXISTS uq_don_event_dedupe\s*\n\s*ON public\.doctor_owner_notifications \(event_type, dedupe_key\)/.test(exMig));

// ─── 5 · Atomicidad del drenado ─────────────────────────────
console.log('\n5. Drenado atómico');
const batch = cuerpoFn(exMig, 'CREATE OR REPLACE FUNCTION public.notify_owner_claim_batch', 'batch');
check('la RPC de lote existe', batch.length > 0);
check('usa FOR UPDATE SKIP LOCKED', /FOR UPDATE SKIP LOCKED/.test(batch));
check('reclama marcando sending', /SET status\s*=\s*'sending'/.test(batch));
check('incrementa attempts', /attempts\s*=\s*n\.attempts \+ 1/.test(batch));
check('sella last_attempt_at', /last_attempt_at\s*=\s*now\(\)/.test(batch));
check('recupera filas sending vencidas', /n\.status = 'sending'\s*\n\s*AND n\.last_attempt_at < now\(\) - v_stale/.test(batch));
check('el lote tiene techo', /LEAST\(GREATEST\(COALESCE\(p_limit/.test(batch));
check('el umbral de antigüedad tiene piso', /GREATEST\(COALESCE\(p_stale_after/.test(batch));
check('orden determinista', /ORDER BY n\.occurred_at, n\.id/.test(batch));

// ─── 5b · Ventana de idempotencia (23 h < 24 h de Resend) ───
// Resend conserva la Idempotency-Key 24 h. Un reintento posterior mandaría un
// SEGUNDO correo de verdad. Estas aserciones cubren los dos casos que pidió el
// owner: dentro de ventana se reintenta, fuera NO.
console.log('\n5b. Ventana de idempotencia');
check('la ventana existe como parámetro', /p_idempotency_window\s+interval\s+DEFAULT interval '23 hours'/.test(batch));
check('el techo de 23 h se aplica con LEAST (ningún llamador lo supera)', /v_window interval := LEAST\([\s\S]{0,200}interval '23 hours'\)/.test(batch));
check('la ventana tiene además un piso', /GREATEST\(COALESCE\(p_idempotency_window/.test(batch));
check('CASO FUERA DE VENTANA: se marca needs_reconciliation', /SET status\s*=\s*'needs_reconciliation'/.test(batch));
check('CASO FUERA DE VENTANA: código corto no-PII', /last_error_code = 'idem_window_expired'/.test(batch));
check('CASO FUERA DE VENTANA: la expiración corre ANTES de elegir el lote', batch.indexOf("'needs_reconciliation'") < batch.indexOf('FOR UPDATE SKIP LOCKED'));
check('CASO FUERA DE VENTANA: se decide por el PRIMER intento, no el último', /first_attempt_at <= now\(\) - v_window/.test(batch));
check('CASO DENTRO DE VENTANA: el lote exige first_attempt_at reciente', /n\.first_attempt_at > now\(\) - v_window/.test(batch));
check('CASO DENTRO DE VENTANA: reintenta con el MISMO id (sin fila nueva)', !/INSERT INTO public\.doctor_owner_notifications/.test(batch));
check('first_attempt_at se fija una vez y no se reescribe', /first_attempt_at = COALESCE\(n\.first_attempt_at, now\(\)\)/.test(batch));
check('needs_reconciliation NO vuelve a entrar al lote', !/status = 'needs_reconciliation'[\s\S]{0,200}FOR UPDATE/.test(batch));
check('la columna first_attempt_at existe', /^\s+first_attempt_at\s+timestamptz,/m.test(exMig));
check('sending exige first_attempt_at', /status <> 'sending' OR \(last_attempt_at IS NOT NULL AND first_attempt_at IS NOT NULL\)/.test(exMig));
check('needs_reconciliation exige motivo y sello', /status <> 'needs_reconciliation'[\s\S]{0,160}first_attempt_at IS NOT NULL AND btrim\(coalesce\(last_error_code, ''\)\) <> ''/.test(exMig));
check('first_attempt_at nunca posterior a last_attempt_at', /first_attempt_at <= last_attempt_at/.test(exMig));
check('el índice de drenado excluye needs_reconciliation', /WHERE status IN \('pending', 'sending'\)/.test(exMig));
check('POST verifica el techo de 23 h', /POST falló: falta el techo de 23 h/.test(mig));
check('POST verifica que no sobreviva la firma sin ventana', /POST falló: sobrevive la firma sin ventana/.test(mig));
check('los grants usan la firma con ventana', /GRANT EXECUTE ON FUNCTION public\.notify_owner_claim_batch\(int, interval, interval\) TO service_role;/.test(exMig));
check('el rollback borra AMBAS firmas', rb.includes('notify_owner_claim_batch(int, interval, interval)') && rb.includes('notify_owner_claim_batch(int, interval);'));

// ─── 6 · Allowlist: sin PII de más ──────────────────────────
console.log('\n6. Allowlist de campos y ausencia de PII');
for (const prohibido of ['license_number', 'doctor_credentials', 'document_number', 'tos_version', 'ip_address', 'user_agent', 'consent_version']) {
  check(`la RPC de lote NO devuelve ${prohibido}`, !batch.includes(prohibido));
}
check('la RPC de lote NO devuelve el texto libre del lead (message)', !/'message'/.test(batch) && !/r\.message/.test(batch));
check('teléfono SOLO en el evento de afiliación', /'phone',\s*\n?\s*CASE WHEN c\.event_type = 'affiliation_submitted' THEN r\.phone END/.test(batch));
check('correo SOLO en el evento de afiliación', /'email',\s*\n?\s*CASE WHEN c\.event_type = 'affiliation_submitted' THEN r\.email END/.test(batch));
const tabla = exMig.slice(exMig.indexOf('CREATE TABLE IF NOT EXISTS public.doctor_owner_notifications'), exMig.indexOf('CREATE UNIQUE INDEX'));
for (const col of ['full_name', 'phone', 'email', 'specialty', 'license']) {
  check(`la outbox NO tiene columna ${col}`, !new RegExp(`^\\s+${col}\\b`, 'm').test(tabla));
}
// Acotado a la MAQUINARIA NUEVA, no al archivo entero: el cuerpo del claim
// trae su propio INSERT INTO audit_log desde s7_13, y debe conservarlo. Medir
// la prohibición contra todo el archivo daría un FAIL por la única escritura
// que sí tiene que estar.
const maquinaria = [
  enq,
  batch,
  cuerpoFn(exMig, 'CREATE OR REPLACE FUNCTION public.notify_owner_mark_result', 'mark'),
  cuerpoFn(exMig, 'CREATE OR REPLACE FUNCTION public._notify_owner_affiliation_fn', 'aff'),
].join('\n');
check('CONTROL: la maquinaria nueva se extrajo entera', maquinaria.length > 1500);
check('la maquinaria de avisos NO escribe en audit_log', !maquinaria.includes('audit_log'));
check('el claim SÍ conserva su escritura de audit_log', c80.join('\n').includes('INSERT INTO audit_log'));

// ─── 7 · Seguridad de la base ───────────────────────────────
console.log('\n7. RLS, grants y search_path');
check('RLS activada en la outbox', /ALTER TABLE public\.doctor_owner_notifications ENABLE ROW LEVEL SECURITY/.test(exMig));
for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
  check(`REVOKE ALL de ${rol} sobre la outbox`, exMig.includes(`REVOKE ALL ON public.doctor_owner_notifications FROM ${rol};`));
}
check('única policy: SELECT para is_admin()', /CREATE POLICY don_select_admin ON public\.doctor_owner_notifications\s*\n\s*FOR SELECT USING \(public\.is_admin\(\)\)/.test(exMig));
eq('no hay policies de escritura', (exMig.match(/CREATE POLICY don_/g) || []).length, 1);
check('solo GRANT SELECT a authenticated', /GRANT SELECT ON public\.doctor_owner_notifications TO authenticated;/.test(exMig));
check('service_role solo lee (diagnóstico)', /GRANT SELECT ON public\.doctor_owner_notifications TO service_role;/.test(exMig));
check('nadie recibe INSERT/UPDATE/DELETE sobre la outbox', !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\.doctor_owner_notifications/.test(exMig));
check('POST verifica que service_role no escriba', /POST falló: service_role puede escribir en la outbox/.test(mig));
check('las RPCs del procesador NO se otorgan a anon', !/GRANT EXECUTE ON FUNCTION public\.notify_owner_\w+\([^)]*\) TO anon/.test(exMig));
check('las RPCs del procesador NO se otorgan a authenticated', !/GRANT EXECUTE ON FUNCTION public\.notify_owner_\w+\([^)]*\) TO authenticated/.test(exMig));
check('claim_batch se otorga SOLO a service_role', /GRANT EXECUTE ON FUNCTION public\.notify_owner_claim_batch\(int, interval, interval\) TO service_role;/.test(exMig));
check('no queda ningún GRANT a la firma vieja sin ventana', !/GRANT EXECUTE ON FUNCTION public\.notify_owner_claim_batch\(int, interval\)/.test(exMig));
check('mark_result se otorga SOLO a service_role', /GRANT EXECUTE ON FUNCTION public\.notify_owner_mark_result\(uuid, text, text, text\) TO service_role;/.test(exMig));
check('el helper de encolado no se otorga a nadie', !/GRANT EXECUTE ON FUNCTION public\._enqueue_doctor_owner_notification/.test(exMig));
eq('las 4 funciones nuevas son SECURITY DEFINER', (exMig.match(/LANGUAGE plpgsql SECURITY DEFINER/g) || []).length, 5); // 4 nuevas + el claim
eq('las 4 funciones nuevas fijan search_path', (exMig.match(/SET search_path = public/g) || []).length, 5);
check('la migración NO instala pg_net', !/CREATE EXTENSION[\s\S]{0,40}pg_net/.test(exMig));
check('la migración NO crea la webhook', !exMig.includes('supabase_functions.http_request'));

// ─── 8 · PRE y POST bloqueantes ─────────────────────────────
console.log('\n8. PRE y POST');
check('PRE aborta si el claim no es el de s7_64', /PRE falló: claim_doctor_profile no parece la versión de s7_64/.test(mig));
check('PRE aborta si s7_80 ya parece aplicada', /PRE falló: claim_doctor_profile ya trae el enqueue/.test(mig));
check('POST verifica RLS de la outbox', /POST falló: RLS no está activa en la outbox/.test(mig));
check('POST verifica ausencia de policies de escritura', /POST falló: la outbox tiene policies de escritura/.test(mig));
check('POST verifica que el trigger sea solo AFTER INSERT', /POST falló: el trigger no es exclusivamente AFTER INSERT/.test(mig));
check('POST verifica invariantes de s7_64 en el claim', /POST falló: claim_doctor_profile perdió alguna invariante de s7_64/.test(mig));
check('POST guarda admin_list_doctors', /POST falló: admin_list_doctors quedó contaminada/.test(mig));
check('POST avisa (sin abortar) si falta pg_net', /RAISE WARNING 's7_80: pg_net NO está instalada/.test(mig));

// ─── 9 · Rollback ───────────────────────────────────────────
console.log('\n9. Rollback');
check('restaura el claim antes de borrar el helper', rb.indexOf('CREATE OR REPLACE FUNCTION claim_doctor_profile(') < rb.indexOf('DROP FUNCTION IF EXISTS public._enqueue_doctor_owner_notification'));
check('el claim restaurado NO encola', !lineasClaim(rb).join('\n').includes('_enqueue_doctor_owner_notification'));
check('borra el trigger de afiliación', rb.includes('DROP TRIGGER IF EXISTS trg_notify_owner_affiliation'));
check('borra las dos RPCs', rb.includes('DROP FUNCTION IF EXISTS public.notify_owner_claim_batch') && rb.includes('DROP FUNCTION IF EXISTS public.notify_owner_mark_result'));
check('borra la outbox', rb.includes('DROP TABLE IF EXISTS public.doctor_owner_notifications'));
check('NO toca el trigger de auditoría de s7_21', !rb.includes('DROP TRIGGER IF EXISTS trg_audit_doctor_affiliation_requests'));
check('POST del rollback comprueba que sobrevive la auditoría de s7_21', rb.includes('se perdio el trigger de auditoria de s7_21'));
check('NO borra filas de audit_log', !/DELETE FROM audit_log/i.test(rb));

// ─── 10 · Edge Function y config ────────────────────────────
console.log('\n10. Edge Function y configuración');
// NO hay `supabase/config.toml`, y es deliberado: un archivo de configuración
// parcial es superficie para `supabase config push`, que empujaría los
// defaults de la CLI sobre la configuración remota del proyecto —Auth,
// Turnstile, SMTP—. Un comentario de advertencia dentro del archivo sería
// documentación, no un control. La bandera `--no-verify-jwt` del comando de
// deploy es por invocación y no tiene ese alcance.
check('NO existe supabase/config.toml', !existsSync(resolve(ROOT, 'supabase/config.toml')));
check('el repo no trae ningún config.toml de Supabase', !existsSync(resolve(ROOT, 'supabase/config.toml')) && !existsSync(resolve(ROOT, 'config.toml')));
check('la guía prohíbe `supabase config push`', /NUNCA ejecutar `supabase config push`/i.test(guia));
check('la guía da el comando de deploy con --no-verify-jwt', /supabase functions deploy notify-owner-doctor-events --no-verify-jwt/.test(guia));
check('la guía acota la bandera a esa única función', /por invocación/.test(guia) && /solo a la función/.test(guia));
check('la guía dice que admin-create-seed-doctor NO se toca', /`admin-create-seed-doctor` no se toca ni se redespliega/.test(guia));
check('la guía mantiene el secreto como control real', /control de acceso real es \*\*`X-Lucycare-Notify-Secret`\*\*/.test(guia));
check('la guía explica por qué se descartó el config.toml', /un comentario de advertencia dentro del archivo es documentación, no un\s*\n?> control técnico/.test(guia));
check('la Edge Function documenta la bandera', fn.includes('--no-verify-jwt'));
check('la Edge Function NO apunta a ningún config.toml', !fn.includes('../config.toml'));
check('la Edge Function explica la ausencia del config.toml', fn.includes('NO tiene `supabase/config.toml`'));
check('la función NO lee el cuerpo del webhook (sin req.json)', !fn.includes('req.json()'));
check('la función NO lee el cuerpo del webhook (sin req.text)', !fn.includes('req.text()'));
check('gate por X-Lucycare-Notify-Secret', fn.includes("req.headers.get('X-Lucycare-Notify-Secret')"));
check('comparación en tiempo constante sobre digests', /crypto\.subtle\.digest\('SHA-256'/.test(fn) && /dif \|= x\[i\] \^ y\[i\]/.test(fn));
check('la comparación no hace short-circuit (===) sobre el secreto', !/recibido === secretoWebhook/.test(fn));
check('fail-closed si falta un secreto', /function requiredSecret[\s\S]*throw new Error\(`\$\{varName\}: ausente`\)/.test(fn));
check('NO configura clave publishable/secret en el webhook', !/sb_publishable_[a-z0-9]/.test(fn) || fn.includes("runtimeKey('SUPABASE_SECRET_KEYS'"));
check('responde 401 genérico', /status: 401[\s\S]{0,80}|'unauthorized'/.test(fn));
check('manda Idempotency-Key a Resend', /'Idempotency-Key': idempotencyKey/.test(fn));
check('el remitente es el aprobado', fn.includes("const FROM = 'LucyCare <notificaciones@lucycare.app>'"));
check('destinatario por DOCTOR_NOTIFICATION_EMAIL', fn.includes("requiredSecret('DOCTOR_NOTIFICATION_EMAIL')"));
check('NO hay correo del owner hardcodeado', !/@(gmail|grupo-ccm|hotmail|outlook)\./i.test(fn));
check('la respuesta no lleva PII (solo contadores)', /JSON\.stringify\(\{ ok: true, processed: procesados, sent: enviados, failed: fallidos \}\)/.test(fn));
check('no se registra ningún secreto', !/console\.(log|error)\([^)]*(resendKey|secretoWebhook|serviceKey)/.test(fn));
check('sin CORS (no hay llamador de navegador)', !fn.includes('Access-Control-Allow-Origin'));

// ─── 11 · CONDUCTUAL: render.ts ejecutado de verdad ─────────
console.log('\n11. Conductual — render.ts transpilado y ejecutado');
const cacheDir = join(ROOT, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, `s780-render-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
const esbuildBin = join(dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');
execFileSync(process.execPath, [
  esbuildBin, RENDER, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`,
], { stdio: 'pipe', cwd: ROOT });
const R = await import(pathToFileURL(out).href);

// 11a · Fechas. El Salvador es UTC-6 todo el año (sin horario de verano).
eq('formatSv: ISO con offset -06:00', R.formatSv('2026-08-02T13:49:49.181225-06:00'), '02/08/2026 13:49');
eq('formatSv: el mismo instante en UTC da lo mismo', R.formatSv('2026-08-02T19:49:49Z'), '02/08/2026 13:49');
eq('formatSv: medianoche es 00:15, nunca 24:15', R.formatSv('2026-08-02T00:15:00-06:00'), '02/08/2026 00:15');
eq('formatSv: la tarde va en 24h, no "01:49 p. m."', R.formatSv('2026-08-02T13:49:00-06:00'), '02/08/2026 13:49');
check('formatSv: sin coma entre fecha y hora', !R.formatSv('2026-08-02T13:49:00-06:00').includes(','));
check('formatSv: sin marcador a.m./p.m.', !/[ap]\.\s?m\./i.test(R.formatSv('2026-08-02T13:49:00-06:00')));
eq('formatSv: null da cadena vacía', R.formatSv(null), '');
eq('formatSv: fecha ilegible conserva el original', R.formatSv('no-es-fecha'), 'no-es-fecha');
eq('formatSv: la zona está fijada (no depende del reloj local)', R.formatSv('2026-01-15T06:00:00Z'), '15/01/2026 00:00');

// 11b · Idempotency-Key
const ID = '11111111-2222-3333-4444-555555555555';
eq('idempotencyKey: derivada del outbox.id', R.idempotencyKey(ID), `lucycare-owner-notif-${ID}`);
eq('idempotencyKey: determinística', R.idempotencyKey(ID), R.idempotencyKey(ID));
check('idempotencyKey: distinta para otro id', R.idempotencyKey(ID) !== R.idempotencyKey('99999999-2222-3333-4444-555555555555'));

// 11c · Render de los dos correos
const afil = {
  id: ID, event_type: 'affiliation_submitted', occurred_at: '2026-08-02T13:49:00-06:00', attempt: 1,
  full_name: 'Dra. Ana Pérez', specialty: 'Cardiología', phone: '50370000000',
  email: 'ana@example.test', doctor_id: null, lucy_status: null,
};
const claim = {
  id: ID, event_type: 'doctor_profile_claimed', occurred_at: '2026-08-02T13:49:00-06:00', attempt: 1,
  full_name: 'Dr. Juan Ramos', specialty: 'Pediatría', phone: null,
  email: null, doctor_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', lucy_status: 'claimed',
};
const ea = R.renderEmail(afil), ec = R.renderEmail(claim);

eq('afiliación: asunto', ea.subject, 'LucyCare · Nueva solicitud de afiliación');
check('afiliación: lleva nombre', ea.text.includes('Dra. Ana Pérez'));
check('afiliación: lleva especialidad', ea.text.includes('Cardiología'));
check('afiliación: lleva teléfono', ea.text.includes('50370000000'));
check('afiliación: lleva correo', ea.text.includes('ana@example.test'));
check('afiliación: lleva fecha formateada', ea.text.includes('02/08/2026 13:49'));
check('afiliación: enlaza la bandeja admin', ea.text.includes('https://lucycare.app/admin/afiliaciones'));
check('afiliación: sin deep-link ?request= (fuera de P0)', !ea.text.includes('?request='));

eq('claim: asunto', ec.subject, 'LucyCare · Perfil médico reclamado');
check('claim: lleva nombre', ec.text.includes('Dr. Juan Ramos'));
check('claim: lleva especialidad', ec.text.includes('Pediatría'));
check('claim: lleva el estado resultante', ec.text.includes('claimed'));
check('claim: enlaza la ficha admin del médico', ec.text.includes('https://lucycare.app/admin/medicos/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
check('claim: NO incluye teléfono', !ec.text.includes('Teléfono'));
check('claim: NO incluye correo', !ec.text.includes('Correo'));

// Dominio literal, jamás el origen del navegador/servidor.
for (const e of [ea, ec]) {
  check('el enlace usa el dominio de producción', e.text.includes('https://lucycare.app/'));
  check('el enlace NO es de vercel.app', !e.text.includes('vercel.app'));
  check('el enlace NO es localhost', !e.text.includes('localhost'));
}

// Campos ausentes no rompen ni escriben "null"/"undefined".
const vacio = R.renderEmail({ ...afil, full_name: null, specialty: null, phone: null, email: null });
check('campos vacíos dan "(no indicado)", no null', vacio.text.includes('(no indicado)'));
check('campos vacíos no escriben "null"', !/:\s+null/.test(vacio.text));
check('campos vacíos no escriben "undefined"', !vacio.text.includes('undefined'));
const sinDoctor = R.renderEmail({ ...claim, doctor_id: null });
check('claim sin doctor_id cae a la lista, sin enlace roto', sinDoctor.text.includes('https://lucycare.app/admin/medicos') && !sinDoctor.text.includes('medicos/null'));

// 11d · errorCode acotado
eq('errorCode: con status', R.errorCode(422, 'resend'), 'resend_422');
eq('errorCode: sin status', R.errorCode(null, 'network'), 'network');
check('errorCode: sanea caracteres raros', !R.errorCode(500, 'a b@c/d').includes('@'));
check('errorCode: acota la longitud', R.errorCode(500, 'x'.repeat(200)).length <= 40);

// ─── 12 · Alcance: el frente no toca el frontend ────────────
console.log('\n12. Alcance');
let tocados = '';
try {
  tocados = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
} catch { tocados = ''; }
const rutas = tocados.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
check('ningún archivo de src/ modificado', !rutas.some((r) => r.startsWith('src/')));
check('ninguna migración previa modificada', !rutas.some((r) => /^migrations\/s7_(7[0-9]|[0-6])/.test(r)));
check('la migración se llama s7_80', existsSync(resolve(ROOT, MIG)));
check('s7_79 sigue existiendo intacta', existsSync(resolve(ROOT, 'migrations/s7_79_admin_doctor_export_slug.sql')));

// ─── 13 · El smoke SQL de la guía ───────────────────────────
// Se audita el bloque que el owner va a PEGAR en el SQL Editor. Un smoke que
// elija mal su sujeto puede tocar una identidad protegida, y eso no se ve
// leyendo por encima.
console.log('\n13. Smoke SQL de docs/OWNER_S7_80_APPLY.md');
const bloques = [...guia.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
const smoke = bloques.find((b) => b.trimStart().startsWith('BEGIN;')) ?? '';
const lin = smoke.trim().split('\n');

check('CONTROL: el bloque del smoke se extrajo entero', lin.length > 80);
check('empieza con BEGIN', lin[0]?.trim() === 'BEGIN;');
check('termina con ROLLBACK', lin[lin.length - 1]?.trim() === 'ROLLBACK;');
check('sin COMMIT en ninguna parte', !/\bCOMMIT\b/i.test(smoke));
check('no habilita pg_net ni crea webhook', !/pg_net|CREATE EXTENSION|supabase_functions|http_request/i.test(smoke));
check('no hace ninguna llamada HTTP', !/net\.http|https?:\/\/|dblink/i.test(smoke));
check('no toca auth.users', !/auth\.users/i.test(smoke));
check('no borra ni trunca nada', !/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\b/i.test(smoke));
check('no crea pacientes, citas ni consultas', !/\bpatients\b|\bappointments\b|\bconsultations\b/i.test(smoke));
// Identidades protegidas.
//
// Camilo se descarta por id, con guarda explícita. Katherine NO se nombra en
// absoluto: excluirla por teléfono obligaría a escribir en el script el dato
// que se quiere proteger, así que el sujeto lo DESIGNA el owner y el smoke no
// consulta ninguna identidad protegida, ni siquiera para descartarla.
check('guarda contra el doctor_id del médico demo', smoke.includes('783a902a-55fd-407c-9e0a-69568135c7f5'));
check('guarda contra el profile_id del médico demo', smoke.includes('db1fba98-a299-4f25-82f1-7feff01e58fa'));
check('NO contiene el teléfono protegido de Katherine', !smoke.includes('50372608827'));
check('NO consulta teléfonos de nadie', !/\bp\.phone\b|\bphone\b(?![_ ]normalized)/.test(smoke.split('doctor_affiliation_requests')[0] ?? ''));
// El sujeto es el perfil QA CONOCIDO, resuelto de forma acotada: PK + nombre.
// Ni listado de médicos, ni ORDER BY sobre la tabla, ni consulta de
// identidades protegidas.
check('el sujeto QA es una constante, no una búsqueda', /v_doc_qa\s+constant uuid := 'ac0ba772-4263-4fb2-a146-dd90033d8c76';/.test(smoke));
check('doble llave: resuelve por PK Y por nombre', /WHERE d\.id = v_doc_qa AND p\.full_name = v_qa_name;/.test(smoke));
check('aborta si el sujeto es el médico demo', /SMOKE abortado: ese es el médico demo protegido/.test(smoke));
check('aborta si el QA no resuelve', /SMOKE abortado: no se resolvió el perfil QA esperado/.test(smoke));
check('NO lista médicos (sin LIMIT sobre doctors salvo la PK)', !/FROM doctors d[\s\S]{0,400}\bLIMIT\b/.test(smoke));
check('NO ordena la tabla de médicos', !/FROM doctors d[\s\S]{0,400}ORDER BY/.test(smoke));

// Guarda de cola vacía: bloqueante y ANTES de escribir nada.
check('guarda bloqueante de cola inicial vacía', /SELECT count\(\*\) INTO v_n FROM doctor_owner_notifications;\s*\n\s*IF v_n <> 0 THEN\s*\n\s*RAISE EXCEPTION/.test(smoke));
check('la guarda de cola corre ANTES del primer INSERT',
  smoke.indexOf('SMOKE abortado: la cola tiene') < smoke.indexOf('INSERT INTO doctor_affiliation_requests'));
check('con la cola vacía los conteos son EXACTOS, no >=',
  /jsonb_array_length\(v_lote\) = 4/.test(smoke) && !/jsonb_array_length\(v_lote\) >= 4/.test(smoke));
// Ventana de idempotencia: ambos casos, ejecutados de verdad.
check('cubre el caso DENTRO de ventana', /interval '2 hours'/.test(smoke) && /dentro de ventana NO se reintentó/.test(smoke));
check('cubre el caso FUERA de ventana', /interval '23 hours 5 minutes'/.test(smoke) && /fuera de ventana SE reenvió/.test(smoke));
check('comprueba needs_reconciliation + idem_window_expired', /needs_reconciliation'\s*\n?\s*AND last_error_code = 'idem_window_expired'/.test(smoke));
check('comprueba que el techo de 23 h no se burla', /interval '48 hours'/.test(smoke) && /burló el techo/.test(smoke));
const casos = [...smoke.matchAll(/FAIL (\d+):/g)].map((m) => Number(m[1]));
check('los casos van numerados sin huecos ni repetidos',
  casos.length > 0 && new Set(casos).size === casos.length &&
  Math.min(...casos) === 1 && Math.max(...casos) === casos.length);
check('el smoke aborta si hubo cualquier FAIL', /IF v_fail > 0 THEN RAISE EXCEPTION/.test(smoke));

// ─── Resumen ────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} · ${fail === 0 ? 'PASS' : `${fail} FAIL`}\n`);
process.exit(fail === 0 ? 0 : 1);
