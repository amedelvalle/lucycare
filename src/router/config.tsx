// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/router/config.tsx
// ACCIÓN: REEMPLAZAR — sustituir contenido completo
// ═══════════════════════════════════════════════════════════

import type { RouteObject } from "react-router-dom";
import NotFound from "../pages/NotFound";
import Home from "../pages/home/page";
import DoctorDetail from "../pages/doctor-detail/page";
import PanelLayout from "../pages/panel/PanelLayout";
import PanelHomePage from "../pages/panel/home/page";
import DisponibilidadPage from "../pages/panel/disponibilidad/page";
import BloqueosPage from "../pages/panel/bloqueos/BloqueosPage";
import CitasPage from "../pages/panel/citas/CitasPage";
import PacientesPage from "../pages/panel/pacientes/PacientesPage";
import PacientePerfilPage from "../pages/panel/pacientes/PacientePerfilPage";
import PerfilPage from "../pages/panel/perfil/PerfilPage";
import ConsultaPage from "../pages/panel/consulta/ConsultaPage";
import CatalogosPage from "../pages/panel/catalogos/CatalogosPage";
import ServiciosPage from "../pages/panel/servicios/ServiciosPage";
import EquipoPage from "../pages/panel/equipo/EquipoPage";
import ListaEsperaPage from "../pages/panel/lista-espera/ListaEsperaPage";
import ReputacionPage from "../pages/panel/reputacion/ReputacionPage";
import CalificarPage from "../pages/calificar/CalificarPage";
import ResetPasswordPage from "../pages/reset-password/ResetPasswordPage";
import MisAtencionesPage from "../pages/paciente/MisAtencionesPage";
import MiPerfilPage from "../pages/paciente/MiPerfilPage";
import PatientOnlyRoute from "./PatientOnlyRoute";
import AdminLayout from "../pages/admin/AdminLayout";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import AdminDoctorsPage from "../pages/admin/AdminDoctorsPage";
import AdminDoctorEditPage from "../pages/admin/AdminDoctorEditPage";
import AdminAffiliationsPage from "../pages/admin/AdminAffiliationsPage";
import AdminCatalogosPage from "../pages/admin/AdminCatalogosPage";
import AdminWaitlistPage from "../pages/admin/AdminWaitlistPage";
import AdminPacientesPage from "../pages/admin/AdminPacientesPage";
import AdminAdministradoresPage from "../pages/admin/AdminAdministradoresPage";
import AdminAnalyticsPage from "../pages/admin/AdminAnalyticsPage";
import AdminAnalyticsFarmaPage from "../pages/admin/AdminAnalyticsFarmaPage";
import PrivacidadPage from "../pages/privacidad/page";
import DoctorOnlyRoute from "./DoctorOnlyRoute";
import AdminOnlyRoute from "./AdminOnlyRoute";
import RequireOwnerAdmin from "./RequireOwnerAdmin";

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
