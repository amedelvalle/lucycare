# Scripts admin de LucyCare

Scripts utilitarios para correr migraciones, verificaciones y maintenance. **No se incluyen en el bundle del frontend** — viven solo en este directorio y se ejecutan en local con Node.

## Setup (una vez por máquina)

1. Copiá `.env.local.example` a `.env.local` en la **raíz del repo** (no acá en `scripts/`).
2. Completá los valores reales desde **Supabase Dashboard → Settings → API**:
   - `SUPABASE_URL` — Project URL.
   - `SUPABASE_ANON_KEY` — anon/public key.
   - `SUPABASE_SERVICE_ROLE_KEY` — **service_role secret**.

`.env.local` ya está en `.gitignore` y **NUNCA debe commitearse**.

> ⚠ El `service_role` key bypassea RLS y da acceso total a la base de datos. Tratalo con el mismo cuidado que la contraseña root.

## Correr un script

Una vez configurado `.env.local`:

```bash
node scripts/check-s7_14.mjs
node scripts/_deactivate-demos.mjs --dry-run
```

Los scripts cargan automáticamente `.env.local` vía `scripts/_lib/env.mjs`. No necesitás `--env-file` ni `dotenv`.

Si falta una variable, el script termina con mensaje claro:

```
❌ Falta variable de entorno SUPABASE_SERVICE_ROLE_KEY.
   Configurá .env.local en la raíz del repo (copiá .env.local.example).
```

## Estructura

```
scripts/
├── _lib/
│   ├── env.mjs               # Carga .env.local, expone requireEnv()
│   ├── supabase-admin.mjs    # Cliente con service_role
│   └── supabase-anon.mjs     # Cliente con anon key
├── check-s7_*.mjs            # Verificadores por migración
├── check-patient-documents.mjs
├── import-doctors.mjs
├── _deactivate-demos.mjs
└── ...
```

## Convención

- Cada script importa el cliente que necesita:
  ```js
  import { supabaseAdmin as s } from './_lib/supabase-admin.mjs';
  // o
  import { supabaseAnon as a } from './_lib/supabase-anon.mjs';
  ```
- NUNCA pongas un JWT hardcoded en un script. Si necesitás un cliente con un usuario específico (otro phone), usá `supabaseAnon` + `auth.signInWithOtp` con tu Test Phone.

## Rotar el `service_role`

Si por algún motivo se sospecha compromiso:

1. **Supabase Dashboard → Settings → API → Reset service_role secret**.
2. El JWT viejo queda invalidado instantáneamente.
3. Actualizá `.env.local` con el nuevo key.
4. Avisar a todos los desarrolladores que tengan `.env.local` viejo.

No hay nada más que cambiar en el repo — los scripts leen desde la env var.
