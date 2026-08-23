/**
 * _smoke-s7_73.mjs — DEPRECADO. NO EJECUTA NADA.
 *
 * El smoke oficial de `s7_73` + `s7_74` es SQL y lo corre el owner:
 *
 *     docs/OWNER_S7_73_SMOKE.md
 *
 * ── POR QUÉ SE RETIRÓ ──
 * La versión anterior de este script ejercitaba las RPCs con `supabaseAdmin`,
 * es decir la secret key SIN JWT de usuario. Con esa credencial:
 *
 *   • `auth.uid()` es NULL — la secret key no lleva `sub`;
 *   • por lo tanto `is_admin()` —que es
 *     EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role='admin')—
 *     es false;
 *   • y la PRIMERA instrucción de las seis RPCs es
 *     IF NOT public.is_admin() THEN RAISE EXCEPTION … P0120.
 *
 * Los 18 casos habrían fallado con P0120. Hay además un segundo bloqueo
 * independiente: `requested_by uuid NOT NULL REFERENCES profiles(id)` recibe
 * `auth.uid()`, que sería NULL → 23502.
 *
 * ⚠️ La cabecera original afirmaba que `service_role` "bypassa is_admin()
 * porque SECURITY DEFINER corre como owner". ERA INCORRECTO: SECURITY DEFINER
 * cambia los privilegios SQL del cuerpo de la función; NO fabrica un
 * `auth.uid()`. Esa frase indujo al error que este archivo ahora previene.
 *
 * ── QUÉ HACE EL SMOKE SQL EN CAMBIO ──
 * Dentro de BEGIN … ROLLBACK, fija `request.jwt.claims` con el `sub` de un
 * admin REAL y EXPLÍCITO que el owner elige. Así `auth.uid()` es válido,
 * `is_admin()` abre y `requested_by` tiene un valor legítimo — y el ROLLBACK
 * revierte todo. Cubre además el lease vencido (`resume`, rotación del token y
 * expulsión del worker viejo), que este script tampoco cubría.
 *
 * Este archivo se conserva, sin lógica, para que una sesión futura no lo
 * ejecute por costumbre. NO hace ninguna llamada de red ni lee credenciales.
 */

console.log(`
  ⛔  _smoke-s7_73.mjs está DEPRECADO y no ejecuta nada.

      Con service_role, auth.uid() es NULL, is_admin() es false y las seis
      RPCs cierran correctamente en P0120. Este script no podía pasar: no
      es que las RPCs estén rotas, es que la credencial no representa a un
      admin.

  ✅  El smoke oficial es SQL y lo corre el owner en el SQL Editor:

          docs/OWNER_S7_73_SMOKE.md

      BLOQUE 0  identificar el admin (read-only)
      BLOQUE 1  BEGIN → set_config(request.jwt.claims) → 33 casos → ROLLBACK
      BLOQUE 2  confirmación de cero residuos

  ℹ️  Verificación estática (sí ejecutable, sin red):

          node scripts/check-s7_73.mjs
          node scripts/check-s7_74.mjs
`);

process.exit(1);
