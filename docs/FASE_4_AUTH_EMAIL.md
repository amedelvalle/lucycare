# Fase 4 PR-A — Email + password login + recuperación por email

> Snapshot 2026-05-25. Setup necesario en Supabase Dashboard antes
> de smoke completo del flujo de reset por email.

## Qué entra en este PR

- `signInWithEmail(email, password)` en `src/services/auth.service.ts`.
- `requestPasswordReset(email)` con respuesta genérica (no revela si el email existe).
- `setPasswordFromRecovery(newPassword)`.
- `destinationForRole(role)` para redirect post-login.
- `LoginModal` reescrito con tabs **Teléfono** (OTP, default — paciente) y **Email** (médico/admin).
- Sub-flujo "¿Olvidaste tu contraseña?" inline en el tab Email.
- Página nueva `/reset-password` que aterriza el link del email y permite definir nueva contraseña.

## Qué NO entra (PR-B y más adelante)

- Activación de contraseña dentro del flujo de Reclamar perfil (PR-B).
- Cambio self-service de email o teléfono.
- 2FA.
- Cambios en booking ni en flow OTP del paciente.

## Configuración requerida en Supabase Dashboard

Para que el flujo de reset por email funcione, hay que configurar 3 cosas:

### 1. URL Configuration (Auth → URL Configuration)

| Campo | Valor |
|---|---|
| **Site URL** | `https://lucycare.vercel.app` |
| **Redirect URLs** (lista) | `https://lucycare.vercel.app/reset-password` |
| | `https://lucycare.vercel.app/**` (si querés cubrir cualquier callback futuro) |
| | `https://lucycare-git-*.vercel.app/**` (para previews — ver nota abajo) |

**Nota sobre previews de Vercel:** Supabase soporta wildcards en `Redirect URLs`. Agregar
`https://lucycare-git-*.vercel.app/**` permite que el reset link redirija a la URL
correcta tanto desde producción como desde cualquier preview de PR. Si **no** lo agregás,
el reset link va a redirigir solo a producción aunque hayas pedido el reset desde un preview.

**Recomendación:** agregar el wildcard de preview. No es un riesgo de seguridad: el token
del link sigue siendo de un solo uso y solo funciona si el browser que abre el link tenía
el `code_verifier` en su localStorage (PKCE flow).

### 2. Email Template — Reset Password (Auth → Email Templates → "Reset Password")

El template por defecto de Supabase funciona pero está en inglés y dice "Supabase". Ajustar:

```
Asunto: Restablecer tu contraseña — LucyCare

Hola,

Recibimos una solicitud para restablecer la contraseña de tu cuenta en LucyCare.

Hacé click en el siguiente link para crear una nueva contraseña:

{{ .ConfirmationURL }}

El link expira en 1 hora. Si vos no pediste esto, ignorá este correo.

— Equipo LucyCare
```

El template usa la variable `{{ .ConfirmationURL }}` que Supabase reemplaza con la URL completa
incluyendo el token (apunta a `Site URL` + `?code=...` por default; con PKCE va al
`redirectTo` que pasamos en `resetPasswordForEmail`).

### 3. Auth settings (Auth → Providers → Email)

- **Enable Email provider:** sí (probablemente ya está activado).
- **Confirm email:** opcional. Si está activado, los usuarios nuevos creados por email
  necesitan confirmar antes de loguearse. Para el caso LucyCare donde los usuarios médicos
  los creamos vía claim, podemos dejarlo activado o desactivado — no nos afecta hoy
  porque PR-A no crea nuevos usuarios por email (eso es PR-B).
- **Secure password change:** recomendado activado.
- **Password policy:** mínimo 8 caracteres (el frontend también lo valida).

## Smoke test de la recuperación

1. Confirmar que un usuario médico tiene email seteado en su profile/auth.users (por ejemplo, Camilo: `carlosmartine@gmail.com`).
2. Producción (después del merge): ir a `https://lucycare.vercel.app/` → "Iniciar sesión" → tab **Email** → "¿Olvidaste tu contraseña?" → ingresar el email → click "Enviar link".
3. El usuario debe ver pantalla "Revisá tu correo" (mensaje genérico, **siempre** se muestra).
4. Verificar en inbox del email indicado que llegó el correo de reset (puede tardar 1-3 min, también revisar spam).
5. Click en el link del correo → debe redirigir a `https://lucycare.vercel.app/reset-password`.
6. La página detecta la sesión de recovery y muestra el form de nueva contraseña.
7. Ingresar nueva contraseña 2 veces → "Guardar y continuar" → redirige según rol (médico → `/panel`, admin → `/admin`).
8. Volver a `/` y loguearse en tab **Email** con el nuevo password — debe funcionar.

## Smoke del login email/password con Camilo

Si querés probar el login email/password con Camilo **antes** de tener el password real:

1. Pedir password reset desde el modal.
2. Recibir el correo en `carlosmartine@gmail.com`.
3. Crear password en `/reset-password`.
4. Cerrar sesión.
5. Login con email + password creada.
6. Debe redirigir a `/panel` (Camilo tiene `role=doctor`).

## Casos de error cubiertos

| Caso | Comportamiento |
|---|---|
| Email no existe | El form de "Olvidaste tu contraseña" muestra "Revisá tu correo" igual (no filtra). |
| Email existe pero password incorrecta en login | Mensaje genérico "Email o contraseña incorrectos…". |
| Link de reset expirado o ya usado | `/reset-password` muestra "Link no válido o expirado" con CTA volver a inicio. |
| Password < 8 caracteres | Form de reset lo bloquea cliente-side. |
| Password ≠ confirmación | Form lo bloquea. |
| Usuario sin profile (raro) | `destinationForRole(null)` → `/`. |

## Seguridad

- Sin tocar RLS.
- Sin tocar policies de profiles.
- `signInWithPassword` y `resetPasswordForEmail` van con la anon key (sb_publishable_*).
- El password queda en `auth.users.encrypted_password` (Supabase, no en nuestra DB).
- El reset link contiene un token PKCE de un solo uso, expira en 1 hora por default.
- Mensaje genérico en `requestPasswordReset` evita enumeración de emails registrados.

## Pendiente para PR-B

Integrar `setPasswordFromRecovery` (o un setPassword nuevo con sesión activa) dentro del flujo de **Reclamar perfil**:

1. Al final del claim (después de validar phone + license), ofrecer al médico:
   - Opción A: "Recibir link por email para crear contraseña" (manda reset link al `profile.email`).
   - Opción B: "Crear contraseña ahora" (si ya está logueado vía OTP, se le pide elegir un password directo).
2. Marcar al médico con `password_set_at` (campo nuevo o derivado) para distinguir cuentas con password vs solo OTP.
