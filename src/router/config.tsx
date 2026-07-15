// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/router/config.tsx
// ACCIÓN: REEMPLAZAR — sustituir contenido completo
// ═══════════════════════════════════════════════════════════

import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

// ─── ESTÁTICAS (en el chunk inicial) ────────────────────────────────
// Rutas públicas/SEO principales + NotFound + guards. Los GUARDS quedan
// estáticos a propósito: deben correr ANTES de resolver la página lazy que
// envuelven, así la protección de auth no depende de que el import termine.
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import DoctorDetail from "../pages/doctor-detail/page";
import PrivacidadPage from "../pages/privacidad/page";
import PatientOnlyRoute from "./PatientOnlyRoute";
import DoctorOnlyRoute from "./DoctorOnlyRoute";
import AdminOnlyRoute from "./AdminOnlyRoute";
import RequireOwnerAdmin from "./RequireOwnerAdmin";

// ─── LAZY (chunks propios, cargados solo al entrar a la ruta) ────────
// Perf P2: el visitante público (Home / /doctor/*) ya no descarga panel,
// admin, paciente, consulta ni las transaccionales. Se resuelven bajo el
// <Suspense> de App.tsx. Los guards estáticos de arriba las envuelven igual.
// Panel médico
const PanelLayout = lazy(() => import("../pages/panel/PanelLayout"));
const PanelHomePage = lazy(() => import("../pages/panel/home/page"));
const DisponibilidadPage = lazy(() => import("../pages/panel/disponibilidad/page"));
const BloqueosPage = lazy(() => import("../pages/panel/bloqueos/BloqueosPage"));
const CitasPage = lazy(() => import("../pages/panel/citas/CitasPage"));
const PacientesPage = lazy(() => import("../pages/panel/pacientes/PacientesPage"));
const PacientePerfilPage = lazy(() => import("../pages/panel/pacientes/PacientePerfilPage"));
const PerfilPage = lazy(() => import("../pages/panel/perfil/PerfilPage"));
const ConsultaPage = lazy(() => import("../pages/panel/consulta/ConsultaPage"));
const CatalogosPage = lazy(() => import("../pages/panel/catalogos/CatalogosPage"));
const ServiciosPage = lazy(() => import("../pages/panel/servicios/ServiciosPage"));
const EquipoPage = lazy(() => import("../pages/panel/equipo/EquipoPage"));
const ListaEsperaPage = lazy(() => import("../pages/panel/lista-espera/ListaEsperaPage"));
const ReputacionPage = lazy(() => import("../pages/panel/reputacion/ReputacionPage"));
// Área paciente
const MisAtencionesPage = lazy(() => import("../pages/paciente/MisAtencionesPage"));
const MiPerfilPage = lazy(() => import("../pages/paciente/MiPerfilPage"));
// LucyAdmin
const AdminLayout = lazy(() => import("../pages/admin/AdminLayout"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage"));
const AdminDoctorsPage = lazy(() => import("../pages/admin/AdminDoctorsPage"));
const AdminDoctorEditPage = lazy(() => import("../pages/admin/AdminDoctorEditPage"));
const AdminAffiliationsPage = lazy(() => import("../pages/admin/AdminAffiliationsPage"));
const AdminCatalogosPage = lazy(() => import("../pages/admin/AdminCatalogosPage"));
const AdminWaitlistPage = lazy(() => import("../pages/admin/AdminWaitlistPage"));
const AdminPacientesPage = lazy(() => import("../pages/admin/AdminPacientesPage"));
const AdminAdministradoresPage = lazy(() => import("../pages/admin/AdminAdministradoresPage"));
const AdminAnalyticsPage = lazy(() => import("../pages/admin/AdminAnalyticsPage"));
const AdminAnalyticsFarmaPage = lazy(() => import("../pages/admin/AdminAnalyticsFarmaPage"));
// Transaccionales (bajo tráfico)
const CalificarPage = lazy(() => import("../pages/calificar/CalificarPage"));
const ResetPasswordPage = lazy(() => import("../pages/reset-password/ResetPasswordPage"));

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/doctor/:id",
    element: <DoctorDetail />,
  },
  {
    path: "/calificar/:token",
    element: <CalificarPage />,
  },
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
  },
  {
    path: "/privacidad",
    element: <PrivacidadPage />,
  },
  {
    path: "/paciente/mis-atenciones",
    element: (
      <PatientOnlyRoute>
        <MisAtencionesPage />
      </PatientOnlyRoute>
    ),
  },
  {
    path: "/paciente/perfil",
    element: (
      <PatientOnlyRoute>
        <MiPerfilPage />
      </PatientOnlyRoute>
    ),
  },
  {
    path: "/admin",
    element: (
      <AdminOnlyRoute>
        <AdminLayout />
      </AdminOnlyRoute>
    ),
    children: [
      // Médicos: accesible por Owner Admin y por directory_editor (nivel acotado).
      // El resto de las secciones son owner-only (RequireOwnerAdmin redirige a
      // /admin/medicos a un nivel acotado).
      {
        index: true,
        element: (
          <RequireOwnerAdmin>
            <AdminDashboardPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "medicos",
        element: <AdminDoctorsPage />,
      },
      {
        path: "medicos/:id",
        element: <AdminDoctorEditPage />,
      },
      {
        path: "afiliaciones",
        element: (
          <RequireOwnerAdmin>
            <AdminAffiliationsPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "catalogos",
        element: (
          <RequireOwnerAdmin>
            <AdminCatalogosPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "lista-espera",
        element: (
          <RequireOwnerAdmin>
            <AdminWaitlistPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "pacientes",
        element: (
          <RequireOwnerAdmin>
            <AdminPacientesPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "administradores",
        element: (
          <RequireOwnerAdmin>
            <AdminAdministradoresPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "analytics",
        element: (
          <RequireOwnerAdmin>
            <AdminAnalyticsPage />
          </RequireOwnerAdmin>
        ),
      },
      {
        path: "analytics/farma",
        element: (
          <RequireOwnerAdmin>
            <AdminAnalyticsFarmaPage />
          </RequireOwnerAdmin>
        ),
      },
    ],
  },
  {
    path: "/panel",
    element: <PanelLayout />,
    children: [
      {
        index: true,
        element: <PanelHomePage />,
      },
      {
        path: "disponibilidad",
        element: <DisponibilidadPage />,
      },
      {
        path: "bloqueos",
        element: <BloqueosPage />,
      },
      {
        path: "citas",
        element: <CitasPage />,
      },
      {
        path: "pacientes",
        element: <PacientesPage />,
      },
      {
        path: "lista-espera",
        element: <ListaEsperaPage />,
      },
      {
        path: "pacientes/:id",
        element: <PacientePerfilPage />,
      },
      {
        path: "perfil",
        element: <DoctorOnlyRoute><PerfilPage /></DoctorOnlyRoute>,
      },
      {
        path: "consulta/:appointmentId",
        element: <DoctorOnlyRoute><ConsultaPage /></DoctorOnlyRoute>,
      },
      {
        path: "catalogos",
        element: <DoctorOnlyRoute><CatalogosPage /></DoctorOnlyRoute>,
      },
      {
        path: "servicios",
        element: <DoctorOnlyRoute><ServiciosPage /></DoctorOnlyRoute>,
      },
      {
        path: "equipo",
        element: <DoctorOnlyRoute><EquipoPage /></DoctorOnlyRoute>,
      },
      {
        path: "reputacion",
        element: <DoctorOnlyRoute><ReputacionPage /></DoctorOnlyRoute>,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
