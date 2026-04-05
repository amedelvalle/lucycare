-- ============================================================
-- LUCYCARE — Seed Data
-- Versión 1.0 • Abril 2026
-- ============================================================
-- EJECUTAR DESPUÉS del schema y las políticas RLS.
-- Contiene: catálogos del sistema + datos de prueba.
-- ============================================================

-- ============================================================
-- 1. DEPARTAMENTOS DE EL SALVADOR (14)
-- ============================================================
INSERT INTO departments (id, name) VALUES
  ('AH', 'Ahuachapán'),
  ('CA', 'Cabañas'),
  ('CH', 'Chalatenango'),
  ('CU', 'Cuscatlán'),
  ('LI', 'La Libertad'),
  ('LP', 'La Paz'),
  ('LU', 'La Unión'),
  ('MO', 'Morazán'),
  ('SA', 'Santa Ana'),
  ('SM', 'San Miguel'),
  ('SO', 'Sonsonate'),
  ('SS', 'San Salvador'),
  ('SV', 'San Vicente'),
  ('US', 'Usulután');

-- ============================================================
-- 2. MUNICIPIOS (principales por departamento)
-- ============================================================
-- San Salvador (19 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('SS-01', 'San Salvador', 'SS'),
  ('SS-02', 'Mejicanos', 'SS'),
  ('SS-03', 'Soyapango', 'SS'),
  ('SS-04', 'Ilopango', 'SS'),
  ('SS-05', 'Ciudad Delgado', 'SS'),
  ('SS-06', 'Cuscatancingo', 'SS'),
  ('SS-07', 'Ayutuxtepeque', 'SS'),
  ('SS-08', 'San Marcos', 'SS'),
  ('SS-09', 'Apopa', 'SS'),
  ('SS-10', 'Tonacatepeque', 'SS'),
  ('SS-11', 'Guazapa', 'SS'),
  ('SS-12', 'Aguilares', 'SS'),
  ('SS-13', 'El Paisnal', 'SS'),
  ('SS-14', 'Rosario de Mora', 'SS'),
  ('SS-15', 'Panchimalco', 'SS'),
  ('SS-16', 'Santo Tomás', 'SS'),
  ('SS-17', 'Santiago Texacuangos', 'SS'),
  ('SS-18', 'Nejapa', 'SS'),
  ('SS-19', 'San Martín', 'SS');

-- La Libertad (22 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('LI-01', 'Santa Tecla', 'LI'),
  ('LI-02', 'Antiguo Cuscatlán', 'LI'),
  ('LI-03', 'La Libertad', 'LI'),
  ('LI-04', 'Colón', 'LI'),
  ('LI-05', 'Quezaltepeque', 'LI'),
  ('LI-06', 'San Juan Opico', 'LI'),
  ('LI-07', 'Ciudad Arce', 'LI'),
  ('LI-08', 'Zaragoza', 'LI'),
  ('LI-09', 'Huizúcar', 'LI'),
  ('LI-10', 'Nuevo Cuscatlán', 'LI'),
  ('LI-11', 'San José Villanueva', 'LI'),
  ('LI-12', 'Jayaque', 'LI'),
  ('LI-13', 'Teotepeque', 'LI'),
  ('LI-14', 'Chiltiupán', 'LI'),
  ('LI-15', 'Jicalapa', 'LI'),
  ('LI-16', 'Tamanique', 'LI'),
  ('LI-17', 'Talnique', 'LI'),
  ('LI-18', 'Sacacoyo', 'LI'),
  ('LI-19', 'Tepecoyo', 'LI'),
  ('LI-20', 'Comasagua', 'LI'),
  ('LI-21', 'San Matías', 'LI'),
  ('LI-22', 'San Pablo Tacachico', 'LI');

-- Santa Ana (13 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('SA-01', 'Santa Ana', 'SA'),
  ('SA-02', 'Metapán', 'SA'),
  ('SA-03', 'Chalchuapa', 'SA'),
  ('SA-04', 'Coatepeque', 'SA'),
  ('SA-05', 'El Congo', 'SA'),
  ('SA-06', 'Texistepeque', 'SA'),
  ('SA-07', 'Candelaria de la Frontera', 'SA'),
  ('SA-08', 'Santa Rosa Guachipilín', 'SA'),
  ('SA-09', 'Santiago de la Frontera', 'SA'),
  ('SA-10', 'San Antonio Pajonal', 'SA'),
  ('SA-11', 'Masahuat', 'SA'),
  ('SA-12', 'San Sebastián Salitrillo', 'SA'),
  ('SA-13', 'El Porvenir', 'SA');

-- San Miguel (20 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('SM-01', 'San Miguel', 'SM'),
  ('SM-02', 'Ciudad Barrios', 'SM'),
  ('SM-03', 'Chinameca', 'SM'),
  ('SM-04', 'Moncagua', 'SM'),
  ('SM-05', 'Quelepa', 'SM'),
  ('SM-06', 'Chirilagua', 'SM'),
  ('SM-07', 'Uluazapa', 'SM'),
  ('SM-08', 'Comacaran', 'SM'),
  ('SM-09', 'San Jorge', 'SM'),
  ('SM-10', 'San Rafael Oriente', 'SM'),
  ('SM-11', 'El Tránsito', 'SM'),
  ('SM-12', 'San Gerardo', 'SM'),
  ('SM-13', 'Lolotique', 'SM'),
  ('SM-14', 'Nueva Guadalupe', 'SM'),
  ('SM-15', 'Sesori', 'SM'),
  ('SM-16', 'Carolina', 'SM'),
  ('SM-17', 'San Luis de la Reina', 'SM'),
  ('SM-18', 'Nuevo Edén de San Juan', 'SM'),
  ('SM-19', 'San Antonio del Mosco', 'SM'),
  ('SM-20', 'Chapeltique', 'SM');

-- Sonsonate (16 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('SO-01', 'Sonsonate', 'SO'),
  ('SO-02', 'Izalco', 'SO'),
  ('SO-03', 'Nahuizalco', 'SO'),
  ('SO-04', 'Acajutla', 'SO'),
  ('SO-05', 'Armenia', 'SO'),
  ('SO-06', 'Juayúa', 'SO'),
  ('SO-07', 'San Antonio del Monte', 'SO'),
  ('SO-08', 'San Julián', 'SO'),
  ('SO-09', 'Cuisnahuat', 'SO'),
  ('SO-10', 'Santa Catarina Masahuat', 'SO'),
  ('SO-11', 'Caluco', 'SO'),
  ('SO-12', 'Nahulingo', 'SO'),
  ('SO-13', 'Santa Isabel Ishuatán', 'SO'),
  ('SO-14', 'Santo Domingo de Guzmán', 'SO'),
  ('SO-15', 'Salcoatitán', 'SO'),
  ('SO-16', 'Sonzacate', 'SO');

-- Usulután (23 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('US-01', 'Usulután', 'US'),
  ('US-02', 'Jiquilisco', 'US'),
  ('US-03', 'Santiago de María', 'US'),
  ('US-04', 'Berlín', 'US'),
  ('US-05', 'Alegría', 'US'),
  ('US-06', 'Jucuapa', 'US'),
  ('US-07', 'El Triunfo', 'US'),
  ('US-08', 'Estanzuelas', 'US'),
  ('US-09', 'Mercedes Umaña', 'US'),
  ('US-10', 'Santa Elena', 'US'),
  ('US-11', 'Santa María', 'US'),
  ('US-12', 'Tecapán', 'US'),
  ('US-13', 'Ozatlán', 'US'),
  ('US-14', 'San Agustín', 'US'),
  ('US-15', 'San Francisco Javier', 'US'),
  ('US-16', 'San Dionisio', 'US'),
  ('US-17', 'Ereguayquín', 'US'),
  ('US-18', 'Concepción Batres', 'US'),
  ('US-19', 'Puerto El Triunfo', 'US'),
  ('US-20', 'California', 'US'),
  ('US-21', 'Nueva Granada', 'US'),
  ('US-22', 'San Buenaventura', 'US'),
  ('US-23', 'Jucuarán', 'US');

-- La Paz (22 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('LP-01', 'Zacatecoluca', 'LP'),
  ('LP-02', 'Olocuilta', 'LP'),
  ('LP-03', 'San Pedro Masahuat', 'LP'),
  ('LP-04', 'Santiago Nonualco', 'LP'),
  ('LP-05', 'San Juan Nonualco', 'LP'),
  ('LP-06', 'San Rafael Obrajuelo', 'LP'),
  ('LP-07', 'El Rosario', 'LP'),
  ('LP-08', 'Cuyultitán', 'LP'),
  ('LP-09', 'Tapalhuaca', 'LP'),
  ('LP-10', 'San Pedro Nonualco', 'LP'),
  ('LP-11', 'San Luis Talpa', 'LP'),
  ('LP-12', 'San Antonio Masahuat', 'LP'),
  ('LP-13', 'San Juan Talpa', 'LP'),
  ('LP-14', 'San Miguel Tepezontes', 'LP'),
  ('LP-15', 'Paraíso de Osorio', 'LP'),
  ('LP-16', 'San Emigdio', 'LP'),
  ('LP-17', 'Jerusalén', 'LP'),
  ('LP-18', 'Mercedes La Ceiba', 'LP'),
  ('LP-19', 'San Luis La Herradura', 'LP'),
  ('LP-20', 'San Juan Tepezontes', 'LP'),
  ('LP-21', 'San Francisco Chinameca', 'LP'),
  ('LP-22', 'Santa María Ostuma', 'LP');

-- Chalatenango (33 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('CH-01', 'Chalatenango', 'CH'),
  ('CH-02', 'La Palma', 'CH'),
  ('CH-03', 'Nueva Concepción', 'CH'),
  ('CH-04', 'San Ignacio', 'CH'),
  ('CH-05', 'Citalá', 'CH'),
  ('CH-06', 'Tejutla', 'CH'),
  ('CH-07', 'Agua Caliente', 'CH'),
  ('CH-08', 'Dulce Nombre de María', 'CH'),
  ('CH-09', 'La Reina', 'CH'),
  ('CH-10', 'El Paraíso', 'CH'),
  ('CH-11', 'San Rafael', 'CH'),
  ('CH-12', 'Santa Rita', 'CH'),
  ('CH-13', 'San Fernando', 'CH'),
  ('CH-14', 'San Francisco Morazán', 'CH'),
  ('CH-15', 'Arcatao', 'CH'),
  ('CH-16', 'Las Vueltas', 'CH'),
  ('CH-17', 'Nombre de Jesús', 'CH'),
  ('CH-18', 'Potonico', 'CH'),
  ('CH-19', 'San Antonio de la Cruz', 'CH'),
  ('CH-20', 'San Isidro Labrador', 'CH'),
  ('CH-21', 'Las Flores', 'CH'),
  ('CH-22', 'San Miguel de Mercedes', 'CH'),
  ('CH-23', 'Cancasque', 'CH'),
  ('CH-24', 'Ojos de Agua', 'CH'),
  ('CH-25', 'Nueva Trinidad', 'CH'),
  ('CH-26', 'San Antonio Los Ranchos', 'CH'),
  ('CH-27', 'San José Las Flores', 'CH'),
  ('CH-28', 'Azacualpa', 'CH'),
  ('CH-29', 'Comalapa', 'CH'),
  ('CH-30', 'El Carrizal', 'CH'),
  ('CH-31', 'Concepción Quezaltepeque', 'CH'),
  ('CH-32', 'San Luis del Carmen', 'CH'),
  ('CH-33', 'San José Cancasque', 'CH');

-- Cuscatlán (16 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('CU-01', 'Cojutepeque', 'CU'),
  ('CU-02', 'Suchitoto', 'CU'),
  ('CU-03', 'San Pedro Perulapán', 'CU'),
  ('CU-04', 'San Rafael Cedros', 'CU'),
  ('CU-05', 'Candelaria', 'CU'),
  ('CU-06', 'San José Guayabal', 'CU'),
  ('CU-07', 'Oratorio de Concepción', 'CU'),
  ('CU-08', 'San Bartolomé Perulapía', 'CU'),
  ('CU-09', 'San Cristóbal', 'CU'),
  ('CU-10', 'Monte San Juan', 'CU'),
  ('CU-11', 'El Carmen', 'CU'),
  ('CU-12', 'El Rosario', 'CU'),
  ('CU-13', 'Santa Cruz Analquito', 'CU'),
  ('CU-14', 'Santa Cruz Michapa', 'CU'),
  ('CU-15', 'San Ramón', 'CU'),
  ('CU-16', 'Tenancingo', 'CU');

-- Ahuachapán (12 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('AH-01', 'Ahuachapán', 'AH'),
  ('AH-02', 'Atiquizaya', 'AH'),
  ('AH-03', 'Jujutla', 'AH'),
  ('AH-04', 'Apaneca', 'AH'),
  ('AH-05', 'Concepción de Ataco', 'AH'),
  ('AH-06', 'Tacuba', 'AH'),
  ('AH-07', 'San Francisco Menéndez', 'AH'),
  ('AH-08', 'Guaymango', 'AH'),
  ('AH-09', 'San Lorenzo', 'AH'),
  ('AH-10', 'San Pedro Puxtla', 'AH'),
  ('AH-11', 'El Refugio', 'AH'),
  ('AH-12', 'Turín', 'AH');

-- Cabañas (9 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('CA-01', 'Sensuntepeque', 'CA'),
  ('CA-02', 'Ilobasco', 'CA'),
  ('CA-03', 'Victoria', 'CA'),
  ('CA-04', 'Dolores', 'CA'),
  ('CA-05', 'Guacotecti', 'CA'),
  ('CA-06', 'San Isidro', 'CA'),
  ('CA-07', 'Jutiapa', 'CA'),
  ('CA-08', 'Tejutepeque', 'CA'),
  ('CA-09', 'Cinquera', 'CA');

-- San Vicente (13 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('SV-01', 'San Vicente', 'SV'),
  ('SV-02', 'Tecoluca', 'SV'),
  ('SV-03', 'Apastepeque', 'SV'),
  ('SV-04', 'Guadalupe', 'SV'),
  ('SV-05', 'San Sebastián', 'SV'),
  ('SV-06', 'Santo Domingo', 'SV'),
  ('SV-07', 'San Esteban Catarina', 'SV'),
  ('SV-08', 'San Ildefonso', 'SV'),
  ('SV-09', 'San Lorenzo', 'SV'),
  ('SV-10', 'Santa Clara', 'SV'),
  ('SV-11', 'San Cayetano Istepeque', 'SV'),
  ('SV-12', 'Tepetitán', 'SV'),
  ('SV-13', 'Verapaz', 'SV');

-- Morazán (26 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('MO-01', 'San Francisco Gotera', 'MO'),
  ('MO-02', 'Jocoro', 'MO'),
  ('MO-03', 'Sociedad', 'MO'),
  ('MO-04', 'Corinto', 'MO'),
  ('MO-05', 'Cacaopera', 'MO'),
  ('MO-06', 'Guatajiagua', 'MO'),
  ('MO-07', 'San Carlos', 'MO'),
  ('MO-08', 'San Simón', 'MO'),
  ('MO-09', 'Osicala', 'MO'),
  ('MO-10', 'Delicias de Concepción', 'MO'),
  ('MO-11', 'Jocoaitique', 'MO'),
  ('MO-12', 'El Divisadero', 'MO'),
  ('MO-13', 'San Fernando', 'MO'),
  ('MO-14', 'Arambala', 'MO'),
  ('MO-15', 'Joateca', 'MO'),
  ('MO-16', 'Meanguera', 'MO'),
  ('MO-17', 'Perquín', 'MO'),
  ('MO-18', 'Torola', 'MO'),
  ('MO-19', 'San Isidro', 'MO'),
  ('MO-20', 'Sensembra', 'MO'),
  ('MO-21', 'Yamabal', 'MO'),
  ('MO-22', 'Chilanga', 'MO'),
  ('MO-23', 'Gualococti', 'MO'),
  ('MO-24', 'Lolotiquillo', 'MO'),
  ('MO-25', 'El Rosario', 'MO'),
  ('MO-26', 'Yoloaiquín', 'MO');

-- La Unión (18 municipios)
INSERT INTO municipalities (id, name, department_id) VALUES
  ('LU-01', 'La Unión', 'LU'),
  ('LU-02', 'Santa Rosa de Lima', 'LU'),
  ('LU-03', 'Pasaquina', 'LU'),
  ('LU-04', 'San Alejo', 'LU'),
  ('LU-05', 'Conchagua', 'LU'),
  ('LU-06', 'El Carmen', 'LU'),
  ('LU-07', 'Intipucá', 'LU'),
  ('LU-08', 'Meanguera del Golfo', 'LU'),
  ('LU-09', 'Yucuaiquín', 'LU'),
  ('LU-10', 'Bolívar', 'LU'),
  ('LU-11', 'Anamorós', 'LU'),
  ('LU-12', 'Lislique', 'LU'),
  ('LU-13', 'Nueva Esparta', 'LU'),
  ('LU-14', 'Polorós', 'LU'),
  ('LU-15', 'Concepción de Oriente', 'LU'),
  ('LU-16', 'El Sauce', 'LU'),
  ('LU-17', 'Yayantique', 'LU'),
  ('LU-18', 'San José', 'LU');

-- ============================================================
-- 3. ESPECIALIDADES MÉDICAS
-- ============================================================
INSERT INTO specialties (id, name, icon) VALUES
  (gen_random_uuid(), 'Cardiología', 'heart'),
  (gen_random_uuid(), 'Pediatría', 'baby'),
  (gen_random_uuid(), 'Dermatología', 'scan'),
  (gen_random_uuid(), 'Neurología', 'brain'),
  (gen_random_uuid(), 'Oftalmología', 'eye'),
  (gen_random_uuid(), 'Ginecología', 'venus'),
  (gen_random_uuid(), 'Traumatología', 'bone'),
  (gen_random_uuid(), 'Psiquiatría', 'mind'),
  (gen_random_uuid(), 'Medicina General', 'stethoscope'),
  (gen_random_uuid(), 'Endocrinología', 'activity'),
  (gen_random_uuid(), 'Gastroenterología', 'stomach'),
  (gen_random_uuid(), 'Urología', 'kidney'),
  (gen_random_uuid(), 'Otorrinolaringología', 'ear'),
  (gen_random_uuid(), 'Neumología', 'lungs'),
  (gen_random_uuid(), 'Cirugía General', 'scissors'),
  (gen_random_uuid(), 'Medicina Interna', 'clipboard'),
  (gen_random_uuid(), 'Oncología', 'ribbon'),
  (gen_random_uuid(), 'Reumatología', 'hand'),
  (gen_random_uuid(), 'Odontología', 'tooth'),
  (gen_random_uuid(), 'Nutrición', 'apple');

-- ============================================================
-- 4. ESTADOS DE CITA (6 estados del ciclo de vida)
-- ============================================================
INSERT INTO appointment_statuses (id, name, display_name, color, funnel_order, is_final, affects_revenue) VALUES
  (gen_random_uuid(), 'programada', 'Programada', '#5b8def', 1, false, false),
  (gen_random_uuid(), 'confirmada', 'Confirmada', '#4caf50', 2, false, false),
  (gen_random_uuid(), 'en_sala', 'En Sala', '#ff9800', 3, false, false),
  (gen_random_uuid(), 'atendida', 'Atendida', '#2e7d32', 4, true, true),
  (gen_random_uuid(), 'cancelada', 'Cancelada', '#f44336', 5, true, false),
  (gen_random_uuid(), 'no_asistio', 'No Asistió', '#9e9e9e', 6, true, false);

-- ============================================================
-- 5. MOTIVOS DE CANCELACIÓN
-- ============================================================
INSERT INTO cancel_reasons (id, name, category) VALUES
  (gen_random_uuid(), 'Paciente no puede asistir', 'paciente'),
  (gen_random_uuid(), 'Paciente se siente mejor', 'paciente'),
  (gen_random_uuid(), 'Paciente prefiere otro médico', 'paciente'),
  (gen_random_uuid(), 'Problema económico', 'paciente'),
  (gen_random_uuid(), 'Médico no disponible', 'medico'),
  (gen_random_uuid(), 'Emergencia médica del doctor', 'medico'),
  (gen_random_uuid(), 'Congreso o capacitación', 'medico'),
  (gen_random_uuid(), 'Error de sistema', 'sistema'),
  (gen_random_uuid(), 'Duplicado', 'sistema'),
  (gen_random_uuid(), 'Fallo de pago', 'sistema');

-- ============================================================
-- 6. TIPOS DE BLOQUEO DE AGENDA
-- ============================================================
INSERT INTO block_types (id, name) VALUES
  (gen_random_uuid(), 'Vacaciones'),
  (gen_random_uuid(), 'Congreso/Capacitación'),
  (gen_random_uuid(), 'Almuerzo'),
  (gen_random_uuid(), 'Emergencia personal'),
  (gen_random_uuid(), 'Feriado'),
  (gen_random_uuid(), 'Mantenimiento de consultorio'),
  (gen_random_uuid(), 'Otro');

-- ============================================================
-- 7. MÉDICOS DE PRUEBA (perfiles de directorio)
-- ============================================================
-- NOTA IMPORTANTE: Estos médicos son datos de prueba SIN usuario
-- real en auth.users. Se insertan directamente con UUIDs ficticios
-- para que el directorio público funcione inmediatamente.
-- En Sprint 1, cuando se implemente auth real, los médicos reales
-- reemplazarán estos registros.
-- ============================================================

-- Primero, crear perfiles ficticios (sin auth.users asociado)
-- Deshabilitamos temporalmente el trigger de auth para poder insertar
-- perfiles de prueba sin usuarios reales.

-- Insertar perfiles de médicos de prueba
INSERT INTO profiles (id, role, full_name, phone, email) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'doctor', 'Dr. Carlos Mendoza García', '+503 2234 5678', 'carlos.mendoza@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000002', 'doctor', 'Dra. María Fernanda López', '+503 2345 6789', 'maria.lopez@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000003', 'doctor', 'Dr. Roberto Sánchez Ruiz', '+503 2456 7890', 'roberto.sanchez@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000004', 'doctor', 'Dra. Ana Patricia Morales', '+503 2567 8901', 'ana.morales@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000005', 'doctor', 'Dr. Luis Alberto Ramírez', '+503 2678 9012', 'luis.ramirez@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000006', 'doctor', 'Dra. Carmen Beatriz Torres', '+503 2789 0123', 'carmen.torres@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000007', 'doctor', 'Dr. Jorge Eduardo Castillo', '+503 2890 1234', 'jorge.castillo@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000008', 'doctor', 'Dra. Sofía Gabriela Herrera', '+503 2901 2345', 'sofia.herrera@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000009', 'doctor', 'Dr. Miguel Ángel Flores', '+503 2012 3456', 'miguel.flores@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000010', 'doctor', 'Dra. Daniela Alejandra Vega', '+503 2123 4567', 'daniela.vega@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000011', 'doctor', 'Dr. Fernando Javier Ortiz', '+503 2234 5679', 'fernando.ortiz@lucycare.test'),
  ('a0000001-0000-0000-0000-000000000012', 'doctor', 'Dra. Valentina Isabel Cruz', '+503 2345 6780', 'valentina.cruz@lucycare.test');

-- Crear clínicas para cada médico
INSERT INTO clinics (id, owner_id, name, phone, address_line, department_id, municipality_id) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'Consultorio Dr. Mendoza - Cardiología', '+503 2234 5678', 'Av. La Revolución 1234, Col. San Benito', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 'Consultorio Dra. López - Pediatría', '+503 2345 6789', 'Calle Arce 567, Col. Centro', 'SA', 'SA-01'),
  ('c0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 'Consultorio Dr. Sánchez - Dermatología', '+503 2456 7890', 'Blvd. del Hipódromo 890, Col. San Benito', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'Consultorio Dra. Morales - Neurología', '+503 2567 8901', 'Av. Independencia 234, Col. Escalón', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 'Consultorio Dr. Ramírez - Oftalmología', '+503 2678 9012', 'Calle Rubén Darío 456, Col. Centro', 'SM', 'SM-01'),
  ('c0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 'Consultorio Dra. Torres - Ginecología', '+503 2789 0123', 'Av. Olimpica 789, Col. Flor Blanca', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 'Consultorio Dr. Castillo - Traumatología', '+503 2890 1234', 'Blvd. Los Próceres 321, Col. San Francisco', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 'Consultorio Dra. Herrera - Psiquiatría', '+503 2901 2345', 'Calle Los Sisimiles 456, Col. Miramonte', 'LI', 'LI-01'),
  ('c0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000009', 'Consultorio Dr. Flores - Medicina General', '+503 2012 3456', 'Av. Manuel Enrique Araujo 678, Col. Escalón', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000010', 'Consultorio Dra. Vega - Endocrinología', '+503 2123 4567', 'Av. La Capilla 901, Col. San Benito', 'SS', 'SS-01'),
  ('c0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000011', 'Consultorio Dr. Ortiz - Cardiología', '+503 2234 5679', 'Calle Loma Linda 1122, Col. Lomas de San Francisco', 'LI', 'LI-02'),
  ('c0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000012', 'Consultorio Dra. Cruz - Pediatría', '+503 2345 6780', 'Av. Roosevelt 345, Col. Flor Blanca', 'SS', 'SS-01');

-- Agregar miembros de clínica (cada médico es owner de su clínica)
INSERT INTO clinic_members (clinic_id, profile_id, role) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'owner'),
  ('c0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 'owner'),
  ('c0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 'owner'),
  ('c0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'owner'),
  ('c0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 'owner'),
  ('c0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 'owner'),
  ('c0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 'owner'),
  ('c0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 'owner'),
  ('c0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000009', 'owner'),
  ('c0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000010', 'owner'),
  ('c0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000011', 'owner'),
  ('c0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000012', 'owner');

-- Crear registros de doctors con datos del mock
-- Usamos subconsulta para obtener el specialty_id correcto
INSERT INTO doctors (id, profile_id, clinic_id, specialty_id, license_number, experience_years, bio, consultation_fee, languages, education, is_verified, is_published, lucy_status, booking_enabled) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
    (SELECT id FROM specialties WHERE name = 'Cardiología' LIMIT 1),
    'JVPM-1234', 15,
    'Especialista en cardiología con más de 15 años de experiencia en el diagnóstico y tratamiento de enfermedades cardiovasculares. Certificado por el Consejo Salvadoreño de Cardiología.',
    80.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Cardiología"},{"institucion":"Cleveland Clinic","titulo":"Fellowship en Cardiología Intervencionista"}]'::jsonb,
    false, true, 'booking_enabled', true),

  ('d0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000002',
    (SELECT id FROM specialties WHERE name = 'Pediatría' LIMIT 1),
    'JVPM-2345', 12,
    'Pediatra dedicada al cuidado integral de niños y adolescentes. Especializada en desarrollo infantil, vacunación y prevención de enfermedades.',
    60.00, '{Español}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Nacional de Niños Benjamín Bloom","titulo":"Especialidad en Pediatría"},{"institucion":"","titulo":"Diplomado en Nutrición Pediátrica"}]'::jsonb,
    false, true, 'listed_only', false),

  ('d0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000003',
    (SELECT id FROM specialties WHERE name = 'Dermatología' LIMIT 1),
    'JVPM-3456', 18,
    'Dermatólogo certificado con amplia experiencia en el tratamiento de enfermedades de la piel, procedimientos estéticos y dermatología cosmética.',
    75.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Dr. José Matías Delgado","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Dermatología"},{"institucion":"","titulo":"Certificación en Dermatología Cosmética"}]'::jsonb,
    false, true, 'claimed', false),

  ('d0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000004',
    (SELECT id FROM specialties WHERE name = 'Neurología' LIMIT 1),
    'JVPM-4567', 20,
    'Neuróloga con vasta experiencia en el diagnóstico y tratamiento de enfermedades del sistema nervioso. Especializada en cefaleas, epilepsia y trastornos del movimiento.',
    85.00, '{Español,Inglés,Francés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Neurología"},{"institucion":"","titulo":"Maestría en Neurociencias"}]'::jsonb,
    true, true, 'verified', true),

  ('d0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 'c0000001-0000-0000-0000-000000000005',
    (SELECT id FROM specialties WHERE name = 'Oftalmología' LIMIT 1),
    'JVPM-5678', 14,
    'Oftalmólogo especializado en cirugía refractiva, cataratas y enfermedades de la retina. Comprometido con la salud visual de sus pacientes.',
    70.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Evangélica de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Oftalmología"},{"institucion":"","titulo":"Fellowship en Cirugía Refractiva"}]'::jsonb,
    false, true, 'booking_enabled', true),

  ('d0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 'c0000001-0000-0000-0000-000000000006',
    (SELECT id FROM specialties WHERE name = 'Ginecología' LIMIT 1),
    'JVPM-6789', 16,
    'Ginecóloga y obstetra dedicada a la salud integral de la mujer. Especializada en embarazo de alto riesgo y cirugía ginecológica mínimamente invasiva.',
    65.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital de Maternidad","titulo":"Especialidad en Ginecología y Obstetricia"},{"institucion":"","titulo":"Certificación en Ultrasonido Obstétrico"}]'::jsonb,
    false, true, 'listed_only', false),

  ('d0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 'c0000001-0000-0000-0000-000000000007',
    (SELECT id FROM specialties WHERE name = 'Traumatología' LIMIT 1),
    'JVPM-7890', 22,
    'Traumatólogo y cirujano ortopedista con más de dos décadas de experiencia. Especializado en cirugía de columna, reemplazo articular y medicina deportiva.',
    90.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Traumatología y Ortopedia"},{"institucion":"Hospital for Special Surgery, NY","titulo":"Fellowship en Cirugía de Columna"}]'::jsonb,
    false, true, 'claimed', false),

  ('d0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 'c0000001-0000-0000-0000-000000000008',
    (SELECT id FROM specialties WHERE name = 'Psiquiatría' LIMIT 1),
    'JVPM-8901', 13,
    'Psiquiatra especializada en trastornos del estado de ánimo, ansiedad y psicoterapia. Enfoque integral combinando tratamiento farmacológico y psicoterapéutico.',
    75.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Centroamericana José Simeón Cañas","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Psiquiatría"},{"institucion":"","titulo":"Certificación en Terapia Cognitivo-Conductual"}]'::jsonb,
    false, true, 'booking_enabled', true),

  ('d0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000009', 'c0000001-0000-0000-0000-000000000009',
    (SELECT id FROM specialties WHERE name = 'Medicina General' LIMIT 1),
    'JVPM-9012', 10,
    'Médico general dedicado a la atención primaria de salud. Enfoque preventivo y manejo integral de enfermedades crónicas.',
    50.00, '{Español}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"","titulo":"Diplomado en Medicina Familiar"},{"institucion":"","titulo":"Certificación en Urgencias Médicas"}]'::jsonb,
    false, true, 'listed_only', false),

  ('d0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000010',
    (SELECT id FROM specialties WHERE name = 'Endocrinología' LIMIT 1),
    'JVPM-0123', 17,
    'Endocrinóloga especializada en diabetes, tiroides y trastornos hormonales. Enfoque personalizado en el manejo de enfermedades metabólicas.',
    80.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Dr. José Matías Delgado","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Endocrinología"},{"institucion":"","titulo":"Maestría en Nutrición Clínica"}]'::jsonb,
    true, true, 'verified', true),

  ('d0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000011', 'c0000001-0000-0000-0000-000000000011',
    (SELECT id FROM specialties WHERE name = 'Cardiología' LIMIT 1),
    'JVPM-1235', 25,
    'Cardiólogo intervencionista con vasta experiencia en procedimientos cardiovasculares complejos. Pionero en técnicas de cateterismo cardíaco en El Salvador.',
    95.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Cardiología"},{"institucion":"Mayo Clinic","titulo":"Fellowship en Cardiología Intervencionista"}]'::jsonb,
    false, true, 'claimed', false),

  ('d0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000012', 'c0000001-0000-0000-0000-000000000012',
    (SELECT id FROM specialties WHERE name = 'Pediatría' LIMIT 1),
    'JVPM-2346', 11,
    'Pediatra apasionada por el cuidado de los niños. Especializada en lactancia materna, desarrollo infantil temprano y enfermedades respiratorias pediátricas.',
    55.00, '{Español}',
    '[{"institucion":"Universidad Evangélica de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Nacional de Niños Benjamín Bloom","titulo":"Especialidad en Pediatría"},{"institucion":"","titulo":"Certificación en Lactancia Materna IBCLC"}]'::jsonb,
    false, true, 'booking_enabled', true);

-- ============================================================
-- 8. SERVICIOS POR MÉDICO (basados en los mocks)
-- ============================================================
-- Dr. Mendoza (Cardiología)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'Consulta general de cardiología', 30, 80.00, 1),
  ('d0000001-0000-0000-0000-000000000001', 'Electrocardiograma', 20, 50.00, 2),
  ('d0000001-0000-0000-0000-000000000001', 'Ecocardiograma', 45, 150.00, 3),
  ('d0000001-0000-0000-0000-000000000001', 'Prueba de esfuerzo', 60, 120.00, 4),
  ('d0000001-0000-0000-0000-000000000001', 'Monitoreo Holter 24hrs', 30, 100.00, 5),
  ('d0000001-0000-0000-0000-000000000001', 'Control de hipertensión', 20, 60.00, 6);

-- Dra. López (Pediatría)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000002', 'Consulta pediátrica general', 30, 60.00, 1),
  ('d0000001-0000-0000-0000-000000000002', 'Control de niño sano', 30, 60.00, 2),
  ('d0000001-0000-0000-0000-000000000002', 'Vacunación', 15, 35.00, 3),
  ('d0000001-0000-0000-0000-000000000002', 'Valoración de crecimiento', 30, 60.00, 4),
  ('d0000001-0000-0000-0000-000000000002', 'Orientación nutricional', 30, 50.00, 5);

-- Dra. Morales (Neurología - verified, booking_enabled)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000004', 'Consulta neurológica', 45, 85.00, 1),
  ('d0000001-0000-0000-0000-000000000004', 'Electroencefalograma', 60, 120.00, 2),
  ('d0000001-0000-0000-0000-000000000004', 'Tratamiento de migraña', 30, 75.00, 3),
  ('d0000001-0000-0000-0000-000000000004', 'Manejo de epilepsia', 45, 85.00, 4),
  ('d0000001-0000-0000-0000-000000000004', 'Trastornos del sueño', 30, 75.00, 5);

-- Dr. Ramírez (Oftalmología - booking_enabled)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000005', 'Consulta oftalmológica', 30, 70.00, 1),
  ('d0000001-0000-0000-0000-000000000005', 'Examen de la vista', 20, 40.00, 2),
  ('d0000001-0000-0000-0000-000000000005', 'Fondo de ojo', 20, 50.00, 3);

-- Dra. Herrera (Psiquiatría - booking_enabled)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000008', 'Consulta psiquiátrica', 60, 75.00, 1),
  ('d0000001-0000-0000-0000-000000000008', 'Tratamiento de depresión', 45, 75.00, 2),
  ('d0000001-0000-0000-0000-000000000008', 'Manejo de ansiedad', 45, 75.00, 3),
  ('d0000001-0000-0000-0000-000000000008', 'Psicoterapia', 60, 80.00, 4);

-- Dra. Vega (Endocrinología - verified, booking_enabled)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000010', 'Consulta endocrinológica', 30, 80.00, 1),
  ('d0000001-0000-0000-0000-000000000010', 'Manejo de diabetes', 30, 80.00, 2),
  ('d0000001-0000-0000-0000-000000000010', 'Trastornos de tiroides', 30, 80.00, 3),
  ('d0000001-0000-0000-0000-000000000010', 'Control de obesidad', 45, 90.00, 4);

-- Dra. Cruz (Pediatría - booking_enabled)
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000012', 'Consulta pediátrica', 30, 55.00, 1),
  ('d0000001-0000-0000-0000-000000000012', 'Asesoría de lactancia', 45, 65.00, 2),
  ('d0000001-0000-0000-0000-000000000012', 'Vacunación completa', 15, 35.00, 3),
  ('d0000001-0000-0000-0000-000000000012', 'Valoración del desarrollo', 30, 55.00, 4);

-- ============================================================
-- FIN DEL SEED DATA
-- ============================================================
-- Resumen insertado:
-- • 14 departamentos
-- • 249 municipios
-- • 20 especialidades
-- • 6 estados de cita
-- • 10 motivos de cancelación
-- • 7 tipos de bloqueo
-- • 12 médicos de prueba (con profiles, clinics, clinic_members)
-- • ~35 servicios para los médicos con booking habilitado
-- ============================================================
