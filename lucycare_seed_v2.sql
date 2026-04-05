-- ============================================================
-- LUCYCARE — Seed Data (Versión 2 — Corregida)
-- Abril 2026
-- ============================================================
-- EJECUTAR DESPUÉS del schema y las políticas RLS.
-- 
-- CAMBIOS vs V1:
-- 1. NO inserta profiles ficticios (evita FK a auth.users)
-- 2. Usa estructura geográfica correcta de El Salvador
-- 3. Agrega campo 'district' a municipalities
-- 4. Los médicos de prueba se insertan al final con un
--    workaround que desactiva temporalmente el FK check.
-- ============================================================

-- ============================================================
-- 0. AGREGAR CAMPO DISTRICT A MUNICIPALITIES
-- ============================================================
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS district TEXT;

-- ============================================================
-- 1. DEPARTAMENTOS DE EL SALVADOR (14)
-- ============================================================
INSERT INTO departments (id, name) VALUES
  ('AH', 'Ahuachapán'),
  ('SA', 'Santa Ana'),
  ('SO', 'Sonsonate'),
  ('CH', 'Chalatenango'),
  ('LI', 'La Libertad'),
  ('SS', 'San Salvador'),
  ('CU', 'Cuscatlán'),
  ('LP', 'La Paz'),
  ('CA', 'Cabañas'),
  ('SV', 'San Vicente'),
  ('US', 'Usulután'),
  ('SM', 'San Miguel'),
  ('MO', 'Morazán'),
  ('LU', 'La Unión');

-- ============================================================
-- 2. MUNICIPIOS CON DISTRITO (estructura oficial SV)
-- ============================================================

-- AHUACHAPÁN (12 municipios, 3 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('AH-01', 'Atiquizaya', 'AH', 'Ahuachapán Norte'),
  ('AH-02', 'El Refugio', 'AH', 'Ahuachapán Norte'),
  ('AH-03', 'San Lorenzo', 'AH', 'Ahuachapán Norte'),
  ('AH-04', 'Turín', 'AH', 'Ahuachapán Norte'),
  ('AH-05', 'Ahuachapán', 'AH', 'Ahuachapán Centro'),
  ('AH-06', 'Apaneca', 'AH', 'Ahuachapán Centro'),
  ('AH-07', 'Concepción de Ataco', 'AH', 'Ahuachapán Centro'),
  ('AH-08', 'Tacuba', 'AH', 'Ahuachapán Centro'),
  ('AH-09', 'Guaymango', 'AH', 'Ahuachapán Sur'),
  ('AH-10', 'Jujutla', 'AH', 'Ahuachapán Sur'),
  ('AH-11', 'San Francisco Menéndez', 'AH', 'Ahuachapán Sur'),
  ('AH-12', 'San Pedro Puxtla', 'AH', 'Ahuachapán Sur');

-- SANTA ANA (13 municipios, 4 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('SA-01', 'Masahuat', 'SA', 'Santa Ana Norte'),
  ('SA-02', 'Metapán', 'SA', 'Santa Ana Norte'),
  ('SA-03', 'Santa Rosa Guachipilín', 'SA', 'Santa Ana Norte'),
  ('SA-04', 'Texistepeque', 'SA', 'Santa Ana Norte'),
  ('SA-05', 'Santa Ana', 'SA', 'Santa Ana Centro'),
  ('SA-06', 'Coatepeque', 'SA', 'Santa Ana Este'),
  ('SA-07', 'El Congo', 'SA', 'Santa Ana Este'),
  ('SA-08', 'Candelaria de la Frontera', 'SA', 'Santa Ana Oeste'),
  ('SA-09', 'Chalchuapa', 'SA', 'Santa Ana Oeste'),
  ('SA-10', 'El Porvenir', 'SA', 'Santa Ana Oeste'),
  ('SA-11', 'San Antonio Pajonal', 'SA', 'Santa Ana Oeste'),
  ('SA-12', 'San Sebastián Salitrillo', 'SA', 'Santa Ana Oeste'),
  ('SA-13', 'Santiago de la Frontera', 'SA', 'Santa Ana Oeste');

-- SONSONATE (16 municipios, 4 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('SO-01', 'Juayúa', 'SO', 'Sonsonate Norte'),
  ('SO-02', 'Nahuizalco', 'SO', 'Sonsonate Norte'),
  ('SO-03', 'Salcoatitán', 'SO', 'Sonsonate Norte'),
  ('SO-04', 'Santa Catarina Masahuat', 'SO', 'Sonsonate Norte'),
  ('SO-05', 'Sonsonate', 'SO', 'Sonsonate Centro'),
  ('SO-06', 'Sonzacate', 'SO', 'Sonsonate Centro'),
  ('SO-07', 'Nahulingo', 'SO', 'Sonsonate Centro'),
  ('SO-08', 'San Antonio del Monte', 'SO', 'Sonsonate Centro'),
  ('SO-09', 'Santo Domingo de Guzmán', 'SO', 'Sonsonate Centro'),
  ('SO-10', 'Armenia', 'SO', 'Sonsonate Este'),
  ('SO-11', 'Caluco', 'SO', 'Sonsonate Este'),
  ('SO-12', 'Cuisnahuat', 'SO', 'Sonsonate Este'),
  ('SO-13', 'Izalco', 'SO', 'Sonsonate Este'),
  ('SO-14', 'San Julián', 'SO', 'Sonsonate Este'),
  ('SO-15', 'Santa Isabel Ishuatán', 'SO', 'Sonsonate Este'),
  ('SO-16', 'Acajutla', 'SO', 'Sonsonate Oeste');

-- CHALATENANGO (33 municipios, 3 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('CH-01', 'Citalá', 'CH', 'Chalatenango Norte'),
  ('CH-02', 'La Palma', 'CH', 'Chalatenango Norte'),
  ('CH-03', 'San Ignacio', 'CH', 'Chalatenango Norte'),
  ('CH-04', 'Agua Caliente', 'CH', 'Chalatenango Centro'),
  ('CH-05', 'Dulce Nombre de María', 'CH', 'Chalatenango Centro'),
  ('CH-06', 'El Paraíso', 'CH', 'Chalatenango Centro'),
  ('CH-07', 'La Reina', 'CH', 'Chalatenango Centro'),
  ('CH-08', 'Nueva Concepción', 'CH', 'Chalatenango Centro'),
  ('CH-09', 'San Fernando', 'CH', 'Chalatenango Centro'),
  ('CH-10', 'San Francisco Morazán', 'CH', 'Chalatenango Centro'),
  ('CH-11', 'San Rafael', 'CH', 'Chalatenango Centro'),
  ('CH-12', 'Santa Rita', 'CH', 'Chalatenango Centro'),
  ('CH-13', 'Arcatao', 'CH', 'Chalatenango Sur'),
  ('CH-14', 'Azacualpa', 'CH', 'Chalatenango Sur'),
  ('CH-15', 'Cancasque', 'CH', 'Chalatenango Sur'),
  ('CH-16', 'Chalatenango', 'CH', 'Chalatenango Sur'),
  ('CH-17', 'Comalapa', 'CH', 'Chalatenango Sur'),
  ('CH-18', 'Concepción Quezaltepeque', 'CH', 'Chalatenango Sur'),
  ('CH-19', 'El Carrizal', 'CH', 'Chalatenango Sur'),
  ('CH-20', 'La Laguna', 'CH', 'Chalatenango Sur'),
  ('CH-21', 'Las Vueltas', 'CH', 'Chalatenango Sur'),
  ('CH-22', 'Nombre de Jesús', 'CH', 'Chalatenango Sur'),
  ('CH-23', 'Nueva Trinidad', 'CH', 'Chalatenango Sur'),
  ('CH-24', 'Ojos de Agua', 'CH', 'Chalatenango Sur'),
  ('CH-25', 'Potonico', 'CH', 'Chalatenango Sur'),
  ('CH-26', 'San Antonio de la Cruz', 'CH', 'Chalatenango Sur'),
  ('CH-27', 'San Antonio Los Ranchos', 'CH', 'Chalatenango Sur'),
  ('CH-28', 'San Francisco Lempa', 'CH', 'Chalatenango Sur'),
  ('CH-29', 'San Isidro Labrador', 'CH', 'Chalatenango Sur'),
  ('CH-30', 'San José Cancasque', 'CH', 'Chalatenango Sur'),
  ('CH-31', 'San José Las Flores', 'CH', 'Chalatenango Sur'),
  ('CH-32', 'San Luis del Carmen', 'CH', 'Chalatenango Sur'),
  ('CH-33', 'Tejutla', 'CH', 'Chalatenango Centro');

-- LA LIBERTAD (22 municipios, 6 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('LI-01', 'Quezaltepeque', 'LI', 'La Libertad Norte'),
  ('LI-02', 'San Matías', 'LI', 'La Libertad Norte'),
  ('LI-03', 'San Pablo Tacachico', 'LI', 'La Libertad Norte'),
  ('LI-04', 'San Juan Opico', 'LI', 'La Libertad Centro'),
  ('LI-05', 'Ciudad Arce', 'LI', 'La Libertad Centro'),
  ('LI-06', 'Colón', 'LI', 'La Libertad Oeste'),
  ('LI-07', 'Jayaque', 'LI', 'La Libertad Oeste'),
  ('LI-08', 'Sacacoyo', 'LI', 'La Libertad Oeste'),
  ('LI-09', 'Talnique', 'LI', 'La Libertad Oeste'),
  ('LI-10', 'Tepecoyo', 'LI', 'La Libertad Oeste'),
  ('LI-11', 'Antiguo Cuscatlán', 'LI', 'La Libertad Este'),
  ('LI-12', 'Huizúcar', 'LI', 'La Libertad Este'),
  ('LI-13', 'Nuevo Cuscatlán', 'LI', 'La Libertad Este'),
  ('LI-14', 'San José Villanueva', 'LI', 'La Libertad Este'),
  ('LI-15', 'Zaragoza', 'LI', 'La Libertad Este'),
  ('LI-16', 'Chiltiupán', 'LI', 'La Libertad Costa'),
  ('LI-17', 'Jicalapa', 'LI', 'La Libertad Costa'),
  ('LI-18', 'La Libertad', 'LI', 'La Libertad Costa'),
  ('LI-19', 'Tamanique', 'LI', 'La Libertad Costa'),
  ('LI-20', 'Teotepeque', 'LI', 'La Libertad Costa'),
  ('LI-21', 'Santa Tecla', 'LI', 'La Libertad Sur'),
  ('LI-22', 'Comasagua', 'LI', 'La Libertad Sur');

-- SAN SALVADOR (19 municipios, 5 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('SS-01', 'Aguilares', 'SS', 'San Salvador Norte'),
  ('SS-02', 'El Paisnal', 'SS', 'San Salvador Norte'),
  ('SS-03', 'Guazapa', 'SS', 'San Salvador Norte'),
  ('SS-04', 'Apopa', 'SS', 'San Salvador Oeste'),
  ('SS-05', 'Nejapa', 'SS', 'San Salvador Oeste'),
  ('SS-06', 'Ilopango', 'SS', 'San Salvador Este'),
  ('SS-07', 'San Martín', 'SS', 'San Salvador Este'),
  ('SS-08', 'Soyapango', 'SS', 'San Salvador Este'),
  ('SS-09', 'Tonacatepeque', 'SS', 'San Salvador Este'),
  ('SS-10', 'Ayutuxtepeque', 'SS', 'San Salvador Centro'),
  ('SS-11', 'Mejicanos', 'SS', 'San Salvador Centro'),
  ('SS-12', 'San Salvador', 'SS', 'San Salvador Centro'),
  ('SS-13', 'Cuscatancingo', 'SS', 'San Salvador Centro'),
  ('SS-14', 'Ciudad Delgado', 'SS', 'San Salvador Centro'),
  ('SS-15', 'Panchimalco', 'SS', 'San Salvador Sur'),
  ('SS-16', 'Rosario de Mora', 'SS', 'San Salvador Sur'),
  ('SS-17', 'San Marcos', 'SS', 'San Salvador Sur'),
  ('SS-18', 'Santo Tomás', 'SS', 'San Salvador Sur'),
  ('SS-19', 'Santiago Texacuangos', 'SS', 'San Salvador Sur');

-- CUSCATLÁN (16 municipios, 2 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('CU-01', 'Suchitoto', 'CU', 'Cuscatlán Norte'),
  ('CU-02', 'San José Guayabal', 'CU', 'Cuscatlán Norte'),
  ('CU-03', 'Oratorio de Concepción', 'CU', 'Cuscatlán Norte'),
  ('CU-04', 'San Bartolomé Perulapía', 'CU', 'Cuscatlán Norte'),
  ('CU-05', 'San Pedro Perulapán', 'CU', 'Cuscatlán Norte'),
  ('CU-06', 'Santa Cruz Michapa', 'CU', 'Cuscatlán Norte'),
  ('CU-07', 'Tenancingo', 'CU', 'Cuscatlán Norte'),
  ('CU-08', 'Cojutepeque', 'CU', 'Cuscatlán Sur'),
  ('CU-09', 'Candelaria', 'CU', 'Cuscatlán Sur'),
  ('CU-10', 'El Carmen', 'CU', 'Cuscatlán Sur'),
  ('CU-11', 'El Rosario', 'CU', 'Cuscatlán Sur'),
  ('CU-12', 'Monte San Juan', 'CU', 'Cuscatlán Sur'),
  ('CU-13', 'San Cristóbal', 'CU', 'Cuscatlán Sur'),
  ('CU-14', 'San Rafael Cedros', 'CU', 'Cuscatlán Sur'),
  ('CU-15', 'San Ramón', 'CU', 'Cuscatlán Sur'),
  ('CU-16', 'Santa Cruz Analquito', 'CU', 'Cuscatlán Sur');

-- Nota: Victoria aparece en tu archivo bajo Cuscatlán Sur pero
-- también en Cabañas. Lo ubico en Cabañas (donde es más conocido).

-- LA PAZ (22 municipios, 3 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('LP-01', 'Cuyultitán', 'LP', 'La Paz Oeste'),
  ('LP-02', 'Olocuilta', 'LP', 'La Paz Oeste'),
  ('LP-03', 'San Juan Talpa', 'LP', 'La Paz Oeste'),
  ('LP-04', 'San Luis Talpa', 'LP', 'La Paz Oeste'),
  ('LP-05', 'San Pedro Masahuat', 'LP', 'La Paz Oeste'),
  ('LP-06', 'Tapalhuaca', 'LP', 'La Paz Oeste'),
  ('LP-07', 'San Francisco Chinameca', 'LP', 'La Paz Oeste'),
  ('LP-08', 'El Rosario', 'LP', 'La Paz Centro'),
  ('LP-09', 'Jerusalén', 'LP', 'La Paz Centro'),
  ('LP-10', 'Mercedes La Ceiba', 'LP', 'La Paz Centro'),
  ('LP-11', 'Paraíso de Osorio', 'LP', 'La Paz Centro'),
  ('LP-12', 'San Antonio Masahuat', 'LP', 'La Paz Centro'),
  ('LP-13', 'San Emigdio', 'LP', 'La Paz Centro'),
  ('LP-14', 'San Juan Tepezontes', 'LP', 'La Paz Centro'),
  ('LP-15', 'San Luis La Herradura', 'LP', 'La Paz Centro'),
  ('LP-16', 'San Miguel Tepezontes', 'LP', 'La Paz Centro'),
  ('LP-17', 'San Pedro Nonualco', 'LP', 'La Paz Centro'),
  ('LP-18', 'Santa María Ostuma', 'LP', 'La Paz Centro'),
  ('LP-19', 'Santiago Nonualco', 'LP', 'La Paz Centro'),
  ('LP-20', 'San Juan Nonualco', 'LP', 'La Paz Este'),
  ('LP-21', 'San Rafael Obrajuelo', 'LP', 'La Paz Este'),
  ('LP-22', 'Zacatecoluca', 'LP', 'La Paz Este');

-- CABAÑAS (9 municipios, 2 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('CA-01', 'Sensuntepeque', 'CA', 'Cabañas Este'),
  ('CA-02', 'Victoria', 'CA', 'Cabañas Este'),
  ('CA-03', 'Dolores', 'CA', 'Cabañas Este'),
  ('CA-04', 'Guacotecti', 'CA', 'Cabañas Este'),
  ('CA-05', 'San Isidro', 'CA', 'Cabañas Este'),
  ('CA-06', 'Ilobasco', 'CA', 'Cabañas Oeste'),
  ('CA-07', 'Tejutepeque', 'CA', 'Cabañas Oeste'),
  ('CA-08', 'Jutiapa', 'CA', 'Cabañas Oeste'),
  ('CA-09', 'Cinquera', 'CA', 'Cabañas Oeste');

-- SAN VICENTE (13 municipios, 2 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('SV-01', 'Apastepeque', 'SV', 'San Vicente Norte'),
  ('SV-02', 'Santa Clara', 'SV', 'San Vicente Norte'),
  ('SV-03', 'San Ildefonso', 'SV', 'San Vicente Norte'),
  ('SV-04', 'San Sebastián', 'SV', 'San Vicente Norte'),
  ('SV-05', 'San Lorenzo', 'SV', 'San Vicente Norte'),
  ('SV-06', 'Santo Domingo', 'SV', 'San Vicente Norte'),
  ('SV-07', 'San Vicente', 'SV', 'San Vicente Sur'),
  ('SV-08', 'Guadalupe', 'SV', 'San Vicente Sur'),
  ('SV-09', 'San Cayetano Istepeque', 'SV', 'San Vicente Sur'),
  ('SV-10', 'Tecoluca', 'SV', 'San Vicente Sur'),
  ('SV-11', 'Tepetitán', 'SV', 'San Vicente Sur'),
  ('SV-12', 'Verapaz', 'SV', 'San Vicente Sur'),
  ('SV-13', 'San Esteban Catarina', 'SV', 'San Vicente Norte');

-- USULUTÁN (23 municipios, 3 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('US-01', 'Alegría', 'US', 'Usulután Norte'),
  ('US-02', 'Berlín', 'US', 'Usulután Norte'),
  ('US-03', 'El Triunfo', 'US', 'Usulután Norte'),
  ('US-04', 'Estanzuelas', 'US', 'Usulután Norte'),
  ('US-05', 'Jucuapa', 'US', 'Usulután Norte'),
  ('US-06', 'Mercedes Umaña', 'US', 'Usulután Norte'),
  ('US-07', 'Nueva Granada', 'US', 'Usulután Norte'),
  ('US-08', 'San Buenaventura', 'US', 'Usulután Norte'),
  ('US-09', 'Santiago de María', 'US', 'Usulután Norte'),
  ('US-10', 'Usulután', 'US', 'Usulután Este'),
  ('US-11', 'Concepción Batres', 'US', 'Usulután Este'),
  ('US-12', 'Ereguayquín', 'US', 'Usulután Este'),
  ('US-13', 'Jucuarán', 'US', 'Usulután Este'),
  ('US-14', 'Ozatlán', 'US', 'Usulután Este'),
  ('US-15', 'Santa Elena', 'US', 'Usulután Este'),
  ('US-16', 'San Dionisio', 'US', 'Usulután Este'),
  ('US-17', 'Santa María', 'US', 'Usulután Este'),
  ('US-18', 'Tecapán', 'US', 'Usulután Este'),
  ('US-19', 'Jiquilisco', 'US', 'Usulután Oeste'),
  ('US-20', 'Puerto El Triunfo', 'US', 'Usulután Oeste'),
  ('US-21', 'San Agustín', 'US', 'Usulután Oeste'),
  ('US-22', 'San Francisco Javier', 'US', 'Usulután Oeste'),
  ('US-23', 'California', 'US', 'Usulután Norte');

-- SAN MIGUEL (20 municipios, 3 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('SM-01', 'Ciudad Barrios', 'SM', 'San Miguel Norte'),
  ('SM-02', 'Sesori', 'SM', 'San Miguel Norte'),
  ('SM-03', 'Nuevo Edén de San Juan', 'SM', 'San Miguel Norte'),
  ('SM-04', 'San Gerardo', 'SM', 'San Miguel Norte'),
  ('SM-05', 'San Luis de la Reina', 'SM', 'San Miguel Norte'),
  ('SM-06', 'Carolina', 'SM', 'San Miguel Norte'),
  ('SM-07', 'San Antonio', 'SM', 'San Miguel Norte'),
  ('SM-08', 'Chapeltique', 'SM', 'San Miguel Norte'),
  ('SM-09', 'San Miguel', 'SM', 'San Miguel Centro'),
  ('SM-10', 'Chirilagua', 'SM', 'San Miguel Centro'),
  ('SM-11', 'Uluazapa', 'SM', 'San Miguel Centro'),
  ('SM-12', 'Comacarán', 'SM', 'San Miguel Centro'),
  ('SM-13', 'Moncagua', 'SM', 'San Miguel Centro'),
  ('SM-14', 'Quelepa', 'SM', 'San Miguel Centro'),
  ('SM-15', 'Chinameca', 'SM', 'San Miguel Oeste'),
  ('SM-16', 'Nueva Guadalupe', 'SM', 'San Miguel Oeste'),
  ('SM-17', 'Lolotique', 'SM', 'San Miguel Oeste'),
  ('SM-18', 'San Jorge', 'SM', 'San Miguel Oeste'),
  ('SM-19', 'San Rafael Oriente', 'SM', 'San Miguel Oeste'),
  ('SM-20', 'El Tránsito', 'SM', 'San Miguel Oeste');

-- MORAZÁN (26 municipios, 2 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('MO-01', 'Arambala', 'MO', 'Morazán Norte'),
  ('MO-02', 'Cacaopera', 'MO', 'Morazán Norte'),
  ('MO-03', 'Corinto', 'MO', 'Morazán Norte'),
  ('MO-04', 'El Rosario', 'MO', 'Morazán Norte'),
  ('MO-05', 'Joateca', 'MO', 'Morazán Norte'),
  ('MO-06', 'Jocoaitique', 'MO', 'Morazán Norte'),
  ('MO-07', 'Meanguera', 'MO', 'Morazán Norte'),
  ('MO-08', 'Perquín', 'MO', 'Morazán Norte'),
  ('MO-09', 'San Fernando', 'MO', 'Morazán Norte'),
  ('MO-10', 'San Isidro', 'MO', 'Morazán Norte'),
  ('MO-11', 'Torola', 'MO', 'Morazán Norte'),
  ('MO-12', 'Chilanga', 'MO', 'Morazán Sur'),
  ('MO-13', 'Delicias de Concepción', 'MO', 'Morazán Sur'),
  ('MO-14', 'El Divisadero', 'MO', 'Morazán Sur'),
  ('MO-15', 'Gualococti', 'MO', 'Morazán Sur'),
  ('MO-16', 'Guatajiagua', 'MO', 'Morazán Sur'),
  ('MO-17', 'Jocoro', 'MO', 'Morazán Sur'),
  ('MO-18', 'Lolotiquillo', 'MO', 'Morazán Sur'),
  ('MO-19', 'Osicala', 'MO', 'Morazán Sur'),
  ('MO-20', 'San Carlos', 'MO', 'Morazán Sur'),
  ('MO-21', 'San Francisco Gotera', 'MO', 'Morazán Sur'),
  ('MO-22', 'San Simón', 'MO', 'Morazán Sur'),
  ('MO-23', 'Sensembra', 'MO', 'Morazán Sur'),
  ('MO-24', 'Sociedad', 'MO', 'Morazán Sur'),
  ('MO-25', 'Yamabal', 'MO', 'Morazán Sur'),
  ('MO-26', 'Yoloaiquín', 'MO', 'Morazán Sur');

-- LA UNIÓN (18 municipios, 2 distritos)
INSERT INTO municipalities (id, name, department_id, district) VALUES
  ('LU-01', 'Anamorós', 'LU', 'La Unión Norte'),
  ('LU-02', 'Bolívar', 'LU', 'La Unión Norte'),
  ('LU-03', 'Concepción de Oriente', 'LU', 'La Unión Norte'),
  ('LU-04', 'El Sauce', 'LU', 'La Unión Norte'),
  ('LU-05', 'Lislique', 'LU', 'La Unión Norte'),
  ('LU-06', 'Nueva Esparta', 'LU', 'La Unión Norte'),
  ('LU-07', 'Pasaquina', 'LU', 'La Unión Norte'),
  ('LU-08', 'Polorós', 'LU', 'La Unión Norte'),
  ('LU-09', 'San José', 'LU', 'La Unión Norte'),
  ('LU-10', 'Santa Rosa de Lima', 'LU', 'La Unión Norte'),
  ('LU-11', 'Conchagua', 'LU', 'La Unión Sur'),
  ('LU-12', 'El Carmen', 'LU', 'La Unión Sur'),
  ('LU-13', 'Intipucá', 'LU', 'La Unión Sur'),
  ('LU-14', 'La Unión', 'LU', 'La Unión Sur'),
  ('LU-15', 'Meanguera del Golfo', 'LU', 'La Unión Sur'),
  ('LU-16', 'San Alejo', 'LU', 'La Unión Sur'),
  ('LU-17', 'Yayantique', 'LU', 'La Unión Sur'),
  ('LU-18', 'Yucuaiquín', 'LU', 'La Unión Sur');

-- ============================================================
-- 3. ESPECIALIDADES MÉDICAS (20)
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
-- 7. MÉDICOS DE PRUEBA (sin depender de auth.users)
-- ============================================================
-- Los médicos de prueba se insertan deshabilitando temporalmente
-- el FK check de profiles → auth.users. Esto es SOLO para seed
-- de desarrollo. En producción, los médicos se crean vía auth.
-- ============================================================

-- Deshabilitar temporalmente verificación de FK
ALTER TABLE profiles DISABLE TRIGGER ALL;

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

-- Rehabilitar triggers
ALTER TABLE profiles ENABLE TRIGGER ALL;

-- Crear clínicas para cada médico
INSERT INTO clinics (id, owner_id, name, phone, address_line, department_id, municipality_id) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'Consultorio Dr. Mendoza - Cardiología', '+503 2234 5678', 'Av. La Revolución 1234, Col. San Benito', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 'Consultorio Dra. López - Pediatría', '+503 2345 6789', 'Calle Arce 567, Col. Centro', 'SA', 'SA-05'),
  ('c0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 'Consultorio Dr. Sánchez - Dermatología', '+503 2456 7890', 'Blvd. del Hipódromo 890, Col. San Benito', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'Consultorio Dra. Morales - Neurología', '+503 2567 8901', 'Av. Independencia 234, Col. Escalón', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 'Consultorio Dr. Ramírez - Oftalmología', '+503 2678 9012', 'Calle Rubén Darío 456, Col. Centro', 'SM', 'SM-09'),
  ('c0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 'Consultorio Dra. Torres - Ginecología', '+503 2789 0123', 'Av. Olimpica 789, Col. Flor Blanca', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 'Consultorio Dr. Castillo - Traumatología', '+503 2890 1234', 'Blvd. Los Próceres 321, Col. San Francisco', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 'Consultorio Dra. Herrera - Psiquiatría', '+503 2901 2345', 'Calle Los Sisimiles 456, Col. Miramonte', 'LI', 'LI-21'),
  ('c0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000009', 'Consultorio Dr. Flores - Medicina General', '+503 2012 3456', 'Av. Manuel Enrique Araujo 678, Col. Escalón', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000010', 'Consultorio Dra. Vega - Endocrinología', '+503 2123 4567', 'Av. La Capilla 901, Col. San Benito', 'SS', 'SS-12'),
  ('c0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000011', 'Consultorio Dr. Ortiz - Cardiología', '+503 2234 5679', 'Calle Loma Linda 1122, Col. Lomas de San Francisco', 'LI', 'LI-11'),
  ('c0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000012', 'Consultorio Dra. Cruz - Pediatría', '+503 2345 6780', 'Av. Roosevelt 345, Col. Flor Blanca', 'SS', 'SS-12');

-- Agregar miembros de clínica
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

-- Crear registros de doctors
INSERT INTO doctors (id, profile_id, clinic_id, specialty_id, license_number, experience_years, bio, consultation_fee, languages, education, is_verified, is_published, lucy_status, booking_enabled) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001',
    (SELECT id FROM specialties WHERE name = 'Cardiología' LIMIT 1),
    'JVPM-1234', 15, 'Especialista en cardiología con más de 15 años de experiencia en el diagnóstico y tratamiento de enfermedades cardiovasculares.',
    80.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Cardiología"},{"institucion":"Cleveland Clinic","titulo":"Fellowship en Cardiología Intervencionista"}]'::jsonb,
    false, true, 'booking_enabled', true),
  ('d0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000002',
    (SELECT id FROM specialties WHERE name = 'Pediatría' LIMIT 1),
    'JVPM-2345', 12, 'Pediatra dedicada al cuidado integral de niños y adolescentes.',
    60.00, '{Español}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Benjamín Bloom","titulo":"Especialidad en Pediatría"}]'::jsonb,
    false, true, 'listed_only', false),
  ('d0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 'c0000001-0000-0000-0000-000000000003',
    (SELECT id FROM specialties WHERE name = 'Dermatología' LIMIT 1),
    'JVPM-3456', 18, 'Dermatólogo certificado con amplia experiencia en enfermedades de la piel y procedimientos estéticos.',
    75.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Dr. José Matías Delgado","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Dermatología"}]'::jsonb,
    false, true, 'claimed', false),
  ('d0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 'c0000001-0000-0000-0000-000000000004',
    (SELECT id FROM specialties WHERE name = 'Neurología' LIMIT 1),
    'JVPM-4567', 20, 'Neuróloga con vasta experiencia en enfermedades del sistema nervioso. Especializada en cefaleas, epilepsia y trastornos del movimiento.',
    85.00, '{Español,Inglés,Francés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Neurología"},{"institucion":"","titulo":"Maestría en Neurociencias"}]'::jsonb,
    true, true, 'verified', true),
  ('d0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 'c0000001-0000-0000-0000-000000000005',
    (SELECT id FROM specialties WHERE name = 'Oftalmología' LIMIT 1),
    'JVPM-5678', 14, 'Oftalmólogo especializado en cirugía refractiva, cataratas y enfermedades de la retina.',
    70.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Evangélica","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Oftalmología"}]'::jsonb,
    false, true, 'booking_enabled', true),
  ('d0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 'c0000001-0000-0000-0000-000000000006',
    (SELECT id FROM specialties WHERE name = 'Ginecología' LIMIT 1),
    'JVPM-6789', 16, 'Ginecóloga y obstetra dedicada a la salud integral de la mujer.',
    65.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital de Maternidad","titulo":"Especialidad en Ginecología"}]'::jsonb,
    false, true, 'listed_only', false),
  ('d0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 'c0000001-0000-0000-0000-000000000007',
    (SELECT id FROM specialties WHERE name = 'Traumatología' LIMIT 1),
    'JVPM-7890', 22, 'Traumatólogo y cirujano ortopedista con más de dos décadas de experiencia.',
    90.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Traumatología"}]'::jsonb,
    false, true, 'claimed', false),
  ('d0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 'c0000001-0000-0000-0000-000000000008',
    (SELECT id FROM specialties WHERE name = 'Psiquiatría' LIMIT 1),
    'JVPM-8901', 13, 'Psiquiatra especializada en trastornos del estado de ánimo, ansiedad y psicoterapia.',
    75.00, '{Español,Inglés}',
    '[{"institucion":"UCA","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Psiquiatría"}]'::jsonb,
    false, true, 'booking_enabled', true),
  ('d0000001-0000-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000009', 'c0000001-0000-0000-0000-000000000009',
    (SELECT id FROM specialties WHERE name = 'Medicina General' LIMIT 1),
    'JVPM-9012', 10, 'Médico general dedicado a la atención primaria de salud.',
    50.00, '{Español}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"}]'::jsonb,
    false, true, 'listed_only', false),
  ('d0000001-0000-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000010', 'c0000001-0000-0000-0000-000000000010',
    (SELECT id FROM specialties WHERE name = 'Endocrinología' LIMIT 1),
    'JVPM-0123', 17, 'Endocrinóloga especializada en diabetes, tiroides y trastornos hormonales.',
    80.00, '{Español,Inglés}',
    '[{"institucion":"Universidad Dr. José Matías Delgado","titulo":"Medicina"},{"institucion":"Hospital Rosales","titulo":"Especialidad en Endocrinología"}]'::jsonb,
    true, true, 'verified', true),
  ('d0000001-0000-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000011', 'c0000001-0000-0000-0000-000000000011',
    (SELECT id FROM specialties WHERE name = 'Cardiología' LIMIT 1),
    'JVPM-1235', 25, 'Cardiólogo intervencionista con vasta experiencia en procedimientos cardiovasculares complejos.',
    95.00, '{Español,Inglés}',
    '[{"institucion":"Universidad de El Salvador","titulo":"Medicina"},{"institucion":"Mayo Clinic","titulo":"Fellowship en Cardiología Intervencionista"}]'::jsonb,
    false, true, 'claimed', false),
  ('d0000001-0000-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000012', 'c0000001-0000-0000-0000-000000000012',
    (SELECT id FROM specialties WHERE name = 'Pediatría' LIMIT 1),
    'JVPM-2346', 11, 'Pediatra apasionada por el cuidado de los niños. Especializada en lactancia materna y desarrollo infantil.',
    55.00, '{Español}',
    '[{"institucion":"Universidad Evangélica","titulo":"Medicina"},{"institucion":"Hospital Benjamín Bloom","titulo":"Especialidad en Pediatría"}]'::jsonb,
    false, true, 'booking_enabled', true);

-- Servicios para médicos con booking habilitado
INSERT INTO services (doctor_id, name, duration_minutes, price, sort_order) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'Consulta general de cardiología', 30, 80.00, 1),
  ('d0000001-0000-0000-0000-000000000001', 'Electrocardiograma', 20, 50.00, 2),
  ('d0000001-0000-0000-0000-000000000001', 'Ecocardiograma', 45, 150.00, 3),
  ('d0000001-0000-0000-0000-000000000001', 'Prueba de esfuerzo', 60, 120.00, 4),
  ('d0000001-0000-0000-0000-000000000001', 'Control de hipertensión', 20, 60.00, 5),
  ('d0000001-0000-0000-0000-000000000004', 'Consulta neurológica', 45, 85.00, 1),
  ('d0000001-0000-0000-0000-000000000004', 'Electroencefalograma', 60, 120.00, 2),
  ('d0000001-0000-0000-0000-000000000004', 'Tratamiento de migraña', 30, 75.00, 3),
  ('d0000001-0000-0000-0000-000000000004', 'Manejo de epilepsia', 45, 85.00, 4),
  ('d0000001-0000-0000-0000-000000000005', 'Consulta oftalmológica', 30, 70.00, 1),
  ('d0000001-0000-0000-0000-000000000005', 'Examen de la vista', 20, 40.00, 2),
  ('d0000001-0000-0000-0000-000000000005', 'Fondo de ojo', 20, 50.00, 3),
  ('d0000001-0000-0000-0000-000000000008', 'Consulta psiquiátrica', 60, 75.00, 1),
  ('d0000001-0000-0000-0000-000000000008', 'Tratamiento de depresión', 45, 75.00, 2),
  ('d0000001-0000-0000-0000-000000000008', 'Manejo de ansiedad', 45, 75.00, 3),
  ('d0000001-0000-0000-0000-000000000008', 'Psicoterapia', 60, 80.00, 4),
  ('d0000001-0000-0000-0000-000000000010', 'Consulta endocrinológica', 30, 80.00, 1),
  ('d0000001-0000-0000-0000-000000000010', 'Manejo de diabetes', 30, 80.00, 2),
  ('d0000001-0000-0000-0000-000000000010', 'Trastornos de tiroides', 30, 80.00, 3),
  ('d0000001-0000-0000-0000-000000000010', 'Control de obesidad', 45, 90.00, 4),
  ('d0000001-0000-0000-0000-000000000012', 'Consulta pediátrica', 30, 55.00, 1),
  ('d0000001-0000-0000-0000-000000000012', 'Asesoría de lactancia', 45, 65.00, 2),
  ('d0000001-0000-0000-0000-000000000012', 'Vacunación completa', 15, 35.00, 3),
  ('d0000001-0000-0000-0000-000000000012', 'Valoración del desarrollo', 30, 55.00, 4);

-- ============================================================
-- FIN DEL SEED DATA V2
-- ============================================================
-- Resumen:
-- • 14 departamentos
-- • 262 municipios con distrito
-- • 20 especialidades
-- • 6 estados de cita
-- • 10 motivos de cancelación
-- • 7 tipos de bloqueo
-- • 12 médicos de prueba (profiles + clinics + clinic_members + doctors)
-- • 24 servicios para médicos con booking habilitado
-- ============================================================
