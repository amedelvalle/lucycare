/**
 * Carga variables de entorno desde `.env.local` en la raíz del repo.
 *
 * Por qué no usamos `dotenv`: para no agregar una dependencia
 * solo para scripts admin. Node 22 acepta `--env-file=.env.local`
 * nativo, pero eso obligaría a recordar el flag en cada invocación
 * (`node --env-file=... scripts/foo.mjs`). Cargando aquí, los
 * scripts se ejecutan como antes: `node scripts/foo.mjs`.
 *
 * Reglas:
 * - Si la var ya está en process.env (ej. setteada por CI/Vercel),
 *   NO la sobreescribimos.
 * - Líneas vacías y comentarios `#` se ignoran.
 * - Valores se trim() y se quita comillas envolventes opcional.
 * - Si .env.local no existe, no hace nada — el caller verá el error
 *   de la var faltante cuando intente usarla, con mensaje claro.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function findEnvLocal() {
  // Busca .env.local subiendo desde el directorio de este archivo
  // hasta dos niveles arriba (covering scripts/_lib/ → repo root).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '.env.local'),
    resolve(process.cwd(), '.env.local'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadLocalEnv() {
  const path = findEnvLocal();
  if (!path) return false;

  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Quitar comillas envolventes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return true;
}

/**
 * Devuelve `process.env[name]` exigiendo que esté presente.
 * Si falta, imprime mensaje claro y sale con código 1.
 */
export function requireEnv(name) {
  loadLocalEnv();
  const v = process.env[name];
  if (!v) {
    console.error(`\n❌ Falta variable de entorno ${name}.`);
    console.error(`   Configurá .env.local en la raíz del repo (copiá .env.local.example).`);
    process.exit(1);
  }
  return v;
}
