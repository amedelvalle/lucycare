# Plan de piloto — 5 médicos LucyCare

> Checklist operativa para llevar LucyCare al piloto con 5 médicos reales.
> Snapshot 2026-05-23. Pre-requisitos antes de empezar.

## 1. Pre-requisitos técnicos (bloqueantes)

| # | Item | Estado | Owner |
|---|---|---|---|
| 1 | Twilio: definir trial vs paga | ⏳ | Owner |
| 2 | Si Twilio trial: agregar los 5 teléfonos como test phones en Supabase | ⏳ | Owner |
| 3 | Reclamo seguro implementado (Fase 2 de `ANALISIS_RECLAMAR_PERFIL.md`) | ⏳ | Dev |
| 4 | Auth robusta para médicos (Fase 1 de `ANALISIS_AUTH_MEDICO.md`) | ⏳ | Dev |
| 5 | Limpieza de datos (ver §3) | ⏳ | Owner |
| 6 | Admin Plataforma con email/password obligatorio | ⏳ | Dev |

## 2. Selección de los 5 médicos

Criterios:
- Médico ya importado con `lucy_status='listed_only'` o conocido por el owner.
- Email válido y verificable (no placeholder del Excel).
- Teléfono activo y verificable.
- Compromiso de probar 2 semanas mínimo.
- Mix de especialidades si es posible.

Lista de candidatos (a definir por owner):
- [ ] Médico 1: ____
- [ ] Médico 2: ____
- [ ] Médico 3: ____
- [ ] Médico 4: ____
- [ ] Médico 5: ____

## 3. Datos a limpiar (detectados por diagnósticos)

| # | Caso | Detalle | Acción |
|---|---|---|---|
| 1 | DUI inválido | Adrian Andres Gomez Alfaro — DUI `0208644789` con 10 dígitos | Editar desde `/panel/pacientes/:id` y corregir |
| 2 | Duplicado por teléfono | Clínica `8ea0fd8f…`: Carlos Eduardo Rodríguez Flores + Cesar Augusto Mendez Ponce, ambos activos con `50377003001` | Decidir: soft-delete a uno + reasignar citas, o mantener ambos |
| 3 | DUI no canónico | Pepe Toro — `020864424` sin guion | Se auto-normaliza al próximo edit; opcional forzar |

Scripts diagnóstico disponibles:
- `node scripts/check-patient-documents.mjs` — lista DUIs inválidos.
- `node scripts/check-s7_11.mjs` — lista pacientes con phone normalizado duplicado.

## 4. Onboarding por médico (checklist por cada uno)

### A. Pre-onboarding (admin)
- [ ] Confirmar que el médico está en DB con `lucy_status='listed_only'`.
- [ ] Confirmar email válido. Si no, editarlo desde `/admin/medicos/:id`.
- [ ] Confirmar teléfono activo. Si no, editarlo.
- [ ] Si en Twilio trial: agregar el teléfono a test phones de Supabase.

### B. Invitación al médico
- [ ] Contacto por canal externo (WhatsApp/email) con instrucciones:
  - URL del directorio: `https://lucycare.app` (dominio público; `lucycare.vercel.app` sigue activo como fallback temporal).
  - Buscar su perfil.
  - Click "Reclamar mi perfil" en la card del médico.
  - Verificar phone (OTP) + tipear licencia.
  - Crear contraseña.

### C. Activación oficial (admin, después del reclamo)
- [ ] Verificar el reclamo en `/admin/medicos` (`lucy_status='claimed'`).
- [ ] Subir/confirmar especialidad y bio (sección "Profesional").
- [ ] Subir/confirmar datos de clínica (sección "Clínica").
- [ ] Crear servicios iniciales (sección "Servicios").
- [ ] Cambiar `lucy_status` → `'verified'` cuando esté listo (LucyAdmin).
- [ ] Marcar `is_published=true`.
- [ ] Activar `booking_enabled=true` si quiere agenda online.

### D. QA post-activación
- [ ] El médico ve su perfil en el directorio público.
- [ ] El badge "Verificado" aparece (si se le activó).
- [ ] Booking online funciona (si activado).
- [ ] El médico puede entrar a `/panel` y ver su agenda.

## 5. QA por rol antes del piloto

### Como paciente
- [ ] Buscar y filtrar médicos en `/`.
- [ ] Abrir perfil de médico.
- [ ] Reservar cita (booking público).
- [ ] Cancelar cita.
- [ ] Calificar después de cita atendida (recibe token, accede a `/calificar/:token`).

### Como médico
- [ ] Login con phone OR email/password.
- [ ] Ver agenda en `/panel/citas` (vista lista y calendario).
- [ ] Marcar paciente confirmado / en sala / atendido.
- [ ] Abrir consulta clínica.
- [ ] Firmar consulta (inmutable post-firma).
- [ ] Editar perfil público (`/panel/perfil`).
- [ ] Gestionar servicios (`/panel/servicios`).
- [ ] Gestionar disponibilidad (`/panel/disponibilidad`).
- [ ] Crear paciente walk-in.
- [ ] Imprimir receta.

### Como asistente
- [ ] Recibir invitación desde `/panel/equipo` del médico.
- [ ] Login con phone (test phone si trial).
- [ ] Ver agenda del médico.
- [ ] Crear walk-in.
- [ ] NO puede firmar consulta (DoctorOnlyRoute bloquea).
- [ ] NO puede acceder a `/panel/perfil`, `/panel/servicios`, `/panel/equipo`, `/panel/catalogos`, `/panel/reputacion`.

### Como admin
- [ ] Login con email/password (recomendado obligatorio antes del piloto).
- [ ] Header muestra botón "Panel Admin".
- [ ] Ver listado de médicos en `/admin/medicos`.
- [ ] Editar perfil/clínica/info/servicios del médico.
- [ ] Cambiar `lucy_status`, `is_published`, `is_operational`.
- [ ] Ver dashboard de métricas en `/admin`.
- [ ] Verificar entrada en `audit_log` después de cada cambio admin.

## 6. Operación durante el piloto

- **Canal de soporte:** definir (WhatsApp / email / form).
- **Frecuencia de check-in:** definir (semanal sugerido).
- **Métricas a monitorear:**
  - Logins por médico (Supabase Auth audit).
  - Citas creadas / atendidas (audit_log + dashboard admin).
  - Bugs reportados (canal de soporte).
  - Tiempo de respuesta del equipo a soporte.
  - Reseñas recibidas (`/panel/reputacion` del médico).

## 7. Criterios de salida del piloto

El piloto se considera exitoso si en 2 semanas:
- [ ] Los 5 médicos lograron reclamar y entrar al panel.
- [ ] Al menos 3 atendieron citas reales.
- [ ] Al menos 1 paciente real calificó.
- [ ] Sin bugs críticos (login bloqueado, pérdida de data, errores PG visibles).
- [ ] Recuperación de acceso funcionó al menos una vez (auto-validación
  del flujo de reset password).

## 8. Post-piloto

Decisiones basadas en aprendizaje:
- Mantener límites actuales o escalar a más médicos.
- Activar `lucy_status='booking_enabled'` para todos los verificados.
- Cerrar fases B4, C, D, E, F, G de Admin SaaS según prioridad real.
- Iniciar integración Stripe / cobros si validamos PMF.
- Decidir sobre upgrade Twilio si no se hizo antes.
- Evaluar 2FA para médicos según interés.

## 9. Documentos relacionados

- `CLAUDE.md` — contexto general.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — estado técnico actual.
- `docs/ANALISIS_AUTH_MEDICO.md` — plan de auth robusta (Fase 1).
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — rediseño de reclamo seguro (Fase 2).
