export default function PanelHomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Panel médico</h1>
      <p className="text-gray-600 mb-8">Bienvenido a tu panel de gestión. Aquí podrás administrar tu agenda, pacientes y configuración.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a href="/panel/disponibilidad" className="p-6 bg-white rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition-all">
          <i className="ri-calendar-line text-3xl text-emerald-700 mb-3"></i>
          <h3 className="font-semibold text-gray-900 mb-1">Disponibilidad</h3>
          <p className="text-sm text-gray-600">Configura tus días y horarios de atención</p>
        </a>

        <a href="/panel/bloqueos" className="p-6 bg-white rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition-all">
          <i className="ri-calendar-close-line text-3xl text-emerald-700 mb-3"></i>
          <h3 className="font-semibold text-gray-900 mb-1">Bloqueos</h3>
          <p className="text-sm text-gray-600">Bloquea días por vacaciones o emergencias</p>
        </a>

        <a href="/panel/citas" className="p-6 bg-white rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-sm transition-all">
          <i className="ri-list-check-2 text-3xl text-emerald-700 mb-3"></i>
          <h3 className="font-semibold text-gray-900 mb-1">Citas</h3>
          <p className="text-sm text-gray-600">Ve tus citas del día y próximas</p>
        </a>
      </div>
    </div>
  );
}
