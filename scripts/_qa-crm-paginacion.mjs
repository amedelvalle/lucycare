/**
 * _qa-crm-paginacion.mjs — PATIENT-CRM-P0 · QA de regresión del filtro por estado.
 *
 *   node scripts/_qa-crm-paginacion.mjs
 *
 * ⚠️ QUÉ PRUEBA Y QUÉ NO.
 *
 * En esta máquina no hay PostgreSQL —ni servidor, ni contenedor, ni driver—, y
 * ejecutar SQL contra Supabase está prohibido. Así que esto NO ejecuta la
 * función `_crm_patients_json`. Lo que hace es modelar las DOS canalizaciones
 * —la defectuosa y la corregida— sobre un dataset sintético, y demostrar que
 * producen resultados distintos en los casos que importan.
 *
 * O sea: prueba la ESPECIFICACIÓN y sirve de A/B del instrumento. La prueba de
 * que el SQL implementa esta especificación es doble: las aserciones
 * estructurales de `check-s7_76` sobre el texto de la migración, y el POST
 * funcional que se corre en vivo DESPUÉS de aplicar `s7_77`.
 *
 * Dataset: 25 identidades sintéticas, sin PII —etiquetas `ID-01`…`ID-27`—, con
 * la coincidencia del filtro colocada a propósito DESPUÉS de la posición 25 del
 * orden general, que es exactamente el caso que el defecto escondía.
 */

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

/* ── Dataset sintético ────────────────────────────────────────
 * 27 identidades ordenadas por `created_at DESC` (id 01 = la más reciente).
 * Tres son `recurrente` y están en las posiciones 26, 27 y 3: dos de ellas
 * caen FUERA de la primera página del orden general.
 */
const ESTADOS = ['nuevo', 'activo', 'en_seguimiento', 'recurrente', 'inactivo', 'bloqueado'];
const UNIVERSO = Array.from({ length: 27 }, (_, i) => ({
  id: `ID-${String(i + 1).padStart(2, '0')}`,
  orden: i,                       // ya viene en el orden created_at DESC, id
  estado: i === 2 || i === 25 || i === 26 ? 'recurrente' : 'activo',
}));

const RECURRENTES = UNIVERSO.filter((r) => r.estado === 'recurrente').map((r) => r.id);

/* ── Allowlist del filtro (espejo de `_crm_status_norm`) ────── */
function normStatus(v) {
  const s = (v ?? '').trim().toLowerCase();
  if (s === '') return null;
  if (!ESTADOS.includes(s)) {
    const e = new Error('Filtro de estado no válido');
    e.code = 'P0147';
    throw e;
  }
  return s;
}

/* ── Canalización CORREGIDA ───────────────────────────────────
 * universo → estado derivado → FILTRO → total → paginación
 */
function correcta({ status = null, limit = 25, offset = 0 } = {}) {
  const st = normStatus(status);
  const base = [...UNIVERSO].sort((a, b) => a.orden - b.orden);
  const calificada = base;                                   // el estado ya está
  const filtrada = st === null ? calificada : calificada.filter((r) => r.estado === st);
  return {
    total: filtrada.length,
    rows: filtrada.slice(offset, offset + limit).map((r) => r.id),
  };
}

/* ── Canalización DEFECTUOSA (la que había) ───────────────────
 * universo → PAGINACIÓN → estado derivado → filtro sobre la página
 */
function defectuosa({ status = null, limit = 25, offset = 0 } = {}) {
  const st = normStatus(status);
  const base = [...UNIVERSO].sort((a, b) => a.orden - b.orden);
  const pagina = base.slice(offset, offset + limit);
  const filtrada = st === null ? pagina : pagina.filter((r) => r.estado === st);
  return {
    total: base.length,          // total SIN filtrar: el paginador mentía
    rows: filtrada.map((r) => r.id),
  };
}

/* ── Exportación: el conjunto filtrado COMPLETO ────────────── */
const MAX_EXPORT = 5000;
const exportar = (impl, status) => impl({ status, limit: MAX_EXPORT + 1, offset: 0 }).rows;

console.log('\n_qa-crm-paginacion — filtro → conteo → paginación\n');
console.log(`  Dataset: ${UNIVERSO.length} identidades sintéticas, sin PII.`);
console.log(`  Recurrentes: ${RECURRENTES.join(', ')} (posiciones 3, 26 y 27).\n`);

/* ═══ A · La canalización corregida ═══════════════════════════ */
console.log('  A) canalización corregida\n');

const sinFiltro = correcta({});
check('sin filtro, el total es el universo completo', sinFiltro.total === 27, String(sinFiltro.total));
check('sin filtro, la página 1 trae 25', sinFiltro.rows.length === 25, String(sinFiltro.rows.length));

const p1 = correcta({ status: 'recurrente', limit: 25, offset: 0 });
check('con filtro, el total es el del conjunto FILTRADO',
  p1.total === RECURRENTES.length, `${p1.total} vs ${RECURRENTES.length}`);
check('la coincidencia de la posición 26 aparece en la PÁGINA 1 del filtro',
  p1.rows.includes('ID-26'), p1.rows.join(','));
check('la de la posición 27 también',
  p1.rows.includes('ID-27'), p1.rows.join(','));
check('la página 1 del filtro trae las tres coincidencias',
  p1.rows.length === 3 && RECURRENTES.every((id) => p1.rows.includes(id)), p1.rows.join(','));

const chico = correcta({ status: 'recurrente', limit: 2, offset: 0 });
const chico2 = correcta({ status: 'recurrente', limit: 2, offset: 2 });
check('paginando el conjunto filtrado, la página 1 trae 2', chico.rows.length === 2, chico.rows.join(','));
check('la página 2 trae la restante', chico2.rows.length === 1, chico2.rows.join(','));
check('las dos páginas no se solapan y cubren el conjunto',
  new Set([...chico.rows, ...chico2.rows]).size === 3);
check('el total no cambia entre páginas', chico.total === 3 && chico2.total === 3);

const vacio = correcta({ status: 'inactivo' });
check('un estado sin coincidencias da total 0 y página vacía',
  vacio.total === 0 && vacio.rows.length === 0);

check('la exportación recorre el conjunto filtrado COMPLETO',
  exportar(correcta, 'recurrente').length === 3, String(exportar(correcta, 'recurrente').length));

/* ═══ B · Allowlist del filtro ════════════════════════════════ */
console.log('\n  B) allowlist cerrada de p_status\n');

for (const st of ESTADOS) {
  check(`acepta '${st}'`, normStatus(st) === st);
}
check('normaliza mayúsculas y espacios', normStatus('  ReCuRrEnTe ') === 'recurrente');
check('vacío y nulo se tratan como "sin filtro"',
  normStatus('') === null && normStatus(null) === null && normStatus('   ') === null);

// Entrada sintética con forma de PII: debe morir antes de consultar y de auditar.
const BASURA = ['Juan 7123-4567', 'recurrente; DROP TABLE patients', 'activo OR 1=1', 'Recurrentes', '../etc'];
for (const v of BASURA) {
  let code = null;
  try { normStatus(v); } catch (e) { code = e.code; }
  check(`rechaza ${JSON.stringify(v)} con P0147`, code === 'P0147', String(code));
}

// Lo que se audita: el valor normalizado o NULL. NUNCA lo que llegó.
function auditarExport(status) {
  const st = normStatus(status);          // lanza ANTES de tocar nada
  return { filtro_estado: st, con_busqueda: false, registros: 0 };
}
let auditado = null;
try { auditado = auditarExport('Juan 7123-4567'); } catch { /* esperado */ }
check('un estado inválido NUNCA llega a la fila de auditoría', auditado === null);
check('un estado válido se audita normalizado',
  auditarExport(' RECURRENTE ').filtro_estado === 'recurrente');
check('sin filtro, el audit guarda NULL', auditarExport(null).filtro_estado === null);

/* ═══ C · A/B: el defecto se reproduce ════════════════════════ */
console.log('\n  C) A/B · la canalización defectuosa falla estas mismas pruebas\n');

const d1 = defectuosa({ status: 'recurrente', limit: 25, offset: 0 });
check('DEFECTUOSA: el total NO es el del conjunto filtrado', d1.total !== RECURRENTES.length,
  `total=${d1.total}, filtradas=${RECURRENTES.length}`);
check('DEFECTUOSA: pierde la coincidencia de la posición 26', !d1.rows.includes('ID-26'),
  d1.rows.join(','));
check('DEFECTUOSA: pierde la de la posición 27', !d1.rows.includes('ID-27'), d1.rows.join(','));
check('DEFECTUOSA: solo devuelve 1 de las 3 coincidencias', d1.rows.length === 1, d1.rows.join(','));

const d2 = defectuosa({ status: 'recurrente', limit: 2, offset: 2 });
check('DEFECTUOSA: la página 2 del filtro devuelve una fila DISTINTA a la correcta',
  JSON.stringify(d2.rows) !== JSON.stringify(chico2.rows),
  `defectuosa=${JSON.stringify(d2.rows)} vs correcta=${JSON.stringify(chico2.rows)}`);

/*
 * La exportación merece una aclaración honesta: con un tope MAYOR que el
 * universo, la canalización defectuosa también encuentra las tres, porque su
 * "página" abarca todo. El defecto aparece en cuanto el universo supera el
 * tope de la ventana — que es exactamente lo que pasa con datos reales.
 */
check('DEFECTUOSA: con tope mayor que el universo, el export no delata el defecto',
  exportar(defectuosa, 'recurrente').length === 3);
const topeChico = 10;
check('DEFECTUOSA: con un tope menor que el universo, el export SÍ pierde coincidencias',
  defectuosa({ status: 'recurrente', limit: topeChico, offset: 0 }).rows.length <
  correcta({ status: 'recurrente', limit: topeChico, offset: 0 }).rows.length,
  `${defectuosa({ status: 'recurrente', limit: topeChico, offset: 0 }).rows.length} vs ${correcta({ status: 'recurrente', limit: topeChico, offset: 0 }).rows.length}`);

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
