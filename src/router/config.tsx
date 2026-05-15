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
import EquipoPage from "../pages/panel/equipo/EquipoPage";
import DoctorOnlyRoute from "./DoctorOnlyRoute";

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
        path: "equipo",
        element: <DoctorOnlyRoute><EquipoPage /></DoctorOnlyRoute>,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
];

export default routes;
