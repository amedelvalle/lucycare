# LucyCare — Estado técnico (documentación breve)

> Snapshot 2026-05-19. Acompaña a `CLAUDE.md` (decisiones/sprints).
> Cubre: 1) mapa entidad-relación, 2) matriz de reglas críticas,
> 3) mapa de flujos UI/UX.

---

## 1. Mapa entidad-relación (BD)

Backend: Supabase (Postgres + Auth OTP SMS + RLS). Entidades núcleo:

```
profiles (id, full_name, phone, email, role[patient|doctor|assistant|admin])
  │
  ├─ doctors (profile_id→profiles, clinic_id→clinics, specialty_id,
  │            bio, consultation_fee, is_published, is_verified, lucy_status)
  │     ├─ services (doctor/clinic; name, duration_minutes, price)
  │     ├─ availability_rules (doctor_id, day_of_week, start_time,
  │     │                      end_time, slot_duration_min, is_active)
  │     ├─ availability_overrides (doctor_id, date_start, date_end,
  │     │                          time_start, time_end, is_blocked)
  │     ├─ diagnoses / medications / family_history_catalog (catálogo per-doctor)
  │     └─ reviews (doctor_id, patient_profile_id→profiles[null ok],
  │                 appointment_id, 6 criterios 1-5, rating numeric(3,2),
  │                 nps, comment, is_visible, submitted_at)
  │
  ├─ clinics (id, name, department_id, municipality_id, address, phone)
  │     ├─ clinic_members (clinic_id, profile_id, role[owner|doctor|assistant], is_active)
  │     └─ clinic_invitations (clinic_id, phone, role, accepted_at, cancelled_at)
  │
  └─ patients (clinic_id, profile_id[null ok], full_name, phone, doc, dob, …)
        │
        └─ appointments (doctor_id, clinic_id, patient_id→patients,
              service_id, status_id→appointment_statuses,
              start_time, end_time, source[manual|lucy_directorio|lucy_seguimiento],
              notes, internal_notes, price, payment_status, cancel_reason_id)
              │
              ├─ consultations (appointment_id, patient_id, status[draft|signed],
              │     chief_complaint, history…, physical_exam, plan, signed_at)
              │     ├─ consultation_diagnoses (diagnosis_id, type, status, notes)
              │     ├─ prescriptions (medication_id, dosage, frequency, duration)
              │     └─ consultation_family_history (family_history_id, notes)
              ├─ vitals (appointment_id; PA, FC, FR, temp, spo2, weight_kg, height_cm)
              └─ review_tokens (appointment_id unique, token, expires_at, used_at)

appointment_statuses: programada · confirmada · en_sala ·
  atendida(final) · cancelada(final) · no_asistio(final)
cancel_reasons (10) · audit_log (inmutable; trigger por tabla)
doctor_rating_stats (vista pública: score ajustado, n_reviews, avg x criterio,
  is_top_rated) · admin_review_traceability (vista solo service_role)
```

Claves: `appointments.patient_id` → **patients** (no profiles).
`reviews.patient_profile_id` → **profiles** (resuelto vía `patients.profile_id`,
nullable para walk-in). RLS en todas; `reviews`/`review_tokens` bloqueadas
(acceso solo por RPC SECURITY DEFINER y vistas).

---

## 2. Matriz de reglas críticas (clínicas / operativas)

| Regla | Capa | Mecanismo |
|---|---|---|
| Solo el médico firma consulta (asistente no) | servicio | `signConsultation` valida `role='doctor'` |
| Firmar consulta → cita pasa a `atendida` (atómico) | DB | trigger `sync_appointment_on_sign` (s6_02) |
| Cita con consulta firmada NO se cancela / cambia estado | DB+svc | trigger `guard_appointment_status_change` (s6_02) + guarda en `updateAppointmentStatus` |
| Consulta firmada = inmutable | app | `status='signed'` → solo lectura |
| No crear/reprogramar cita en el pasado | DB+svc+UI | trigger `block_past_appointment` (s6_03) + `isPastStart` + min en date input / slots |
| No crear/reprogramar fuera de disponibilidad | DB+svc+UI | trigger s6_04 + `isWithinDoctorAvailability` + selector solo slots válidos |
| No reprogramar cita en estado final o firmada | DB+svc | trigger `block_reschedule_locked` (s6_10) + `updateAppointment` |
| No doble reserva (horario ocupado) | svc | chequeo de solape excluyendo cancelada/no_asistio (walk-in / edición) |
| Editable: programada/confirmada full; en_sala solo notas/precio | svc+UI | `isAppointmentEditable()` + `updateAppointment` |
| Cambiar paciente de cita solo si no hay consulta | svc | `updateAppointment` valida ausencia de consultations |
| Transiciones de estado válidas | svc | `canTransitionTo` (programada→confirmada→en_sala→atendida…) |
| No marcar atendida >24h antes / no_asistio antes de la hora | svc | `canTransitionTo` reglas de tiempo |
| 1 calificación por cita | DB | `UNIQUE(appointment_id)` parcial + `submit_review` ON CONFLICT |
| Encuesta: token 1 uso, vence 7 días, solo cita atendida | DB | `submit_review` valida token/used/expiry/estado |
| Rating público = promedio ponderado ajustado, ventana 12m | DB | vista `doctor_rating_stats` (bayesiano C=10, m=4.0) |
| "Mejor valorado" solo si score≥4.7 y ≥20 reseñas | DB+UI | `is_top_rated` en vista; badge condicionado |
| Etiquetas públicas solo si criterio≥4.5 y ≥10 reseñas | app | `deriveReviewTags` |
| Reseñas anónimas para el médico (sin nombre/tel/fecha exacta) | DB | RPC `get_my_review_comments` (solo rating/comment/meses) |
| Rutas doctor-only (perfil/equipo/catálogos/reputación) | app | `DoctorOnlyRoute` + filtro nav |
| Auditoría inmutable | DB | triggers `audit_*` → `audit_log` |

---

## 3. Mapa de flujos UI/UX principales

**Público / paciente**
- `/` directorio: buscar/filtrar médicos, orden "Mejor valorados" (score real),
  tarjeta con rating real o "Sin calificaciones aún", avatar con fallback.
- `/doctor/:id` perfil: info, servicios, ubicación, **Calificaciones reales**
  (score, barras por criterio, etiquetas, "lo que más valoran") + booking.
- Booking (BookingCard): OTP login → slots disponibles → cita `lucy_directorio`.
- `/calificar/:token` (sin login): encuesta 6 criterios + NPS + comentario.
- Nav cross-role: doctor/asistente logueado ve "Mi panel"; SPA fallback (vercel.json).

**Panel médico / asistente** (`/panel`)
- Inicio (stats) · Disponibilidad · Bloqueos · **Citas** · Pacientes.
- Citas: vista Lista/Calendario; tarjeta responsive (mobile apila);
  detalle lateral → cambiar estado, **Editar cita** (si estado lo permite),
  abrir consulta, **link de encuesta** (copiar/WhatsApp) si atendida.
- Walk-in / Follow-up: selector de hora = solo slots disponibles.
- Consulta clínica `/panel/consulta/:id`: anamnesis, vitales (IMC),
  antecedentes, diagnósticos, receta, plan, **Firmar** (inmutable, error
  visible si falla) → cita atendida + token de encuesta.
- Doctor-only: Catálogos · Mi equipo (invitar asistente) · Mi perfil público ·
  **Mi reputación** (score + comentarios anónimos).
- Asistente: agenda y pacientes; sin firmar ni rutas doctor-only.
- ScrollToTop global al cambiar de ruta.

**Admin** (Sprint 6: solo SQL)
- Trazabilidad de reputación vía vista `admin_review_traceability`
  (service_role). UI admin completa = Sprint 7/8.

---

## Migraciones aplicadas (verificadas en DB)

`s4_*`, `s5_01..s5_07`, `s6_01..s6_10`. Cada `s6_*` tiene script
`scripts/check-s6_0X.mjs` que valida su estado de forma no destructiva.

## Deudas / pendientes conocidos

- Cambio de paciente en cita: soportado en servicio, no expuesto en UI.
- S5-08: SMS automático al invitar asistente (hoy entra por OTP normal).
- "Más cercanos" en directorio: no-op (requiere geolocalización).
- Sprint 7/8: Admin SaaS (UI de aprobación de médicos, dashboard tracción,
  UI de la trazabilidad de reputación).
