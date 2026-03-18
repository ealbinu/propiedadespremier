/**
 * setup-pb.mjs
 * Script de setup/migración para PocketBase.
 * Crea o actualiza colecciones según las definiciones abajo.
 *
 * Uso:
 *   node scripts/setup-pb.mjs
 *
 * Requiere variables de entorno en .env:
 *   PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Leer .env manualmente (sin dependencias extra)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch {
  console.error('⚠️  No se encontró .env — usando variables de entorno del sistema');
}

const PB_URL = process.env.PB_URL || 'https://propiedadespr.pockethost.io';
const EMAIL = process.env.PB_SUPERUSER_EMAIL;
const PASSWORD = process.env.PB_SUPERUSER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('❌ Faltan PB_SUPERUSER_EMAIL o PB_SUPERUSER_PASSWORD en .env');
  process.exit(1);
}

// ─── Autenticar ───────────────────────────────────────────────────────────────
async function getToken() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Auth fallida: ${JSON.stringify(data)}`);
  return data.token;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getCollections(token) {
  const res = await fetch(`${PB_URL}/api/collections?perPage=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.items || [];
}

async function createCollection(token, schema) {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(schema),
  });
  return res.json();
}

async function patchCollection(token, nameOrId, patch) {
  const res = await fetch(`${PB_URL}/api/collections/${nameOrId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return res.json();
}

// ─── Definiciones de colecciones ──────────────────────────────────────────────
const COLLECTIONS = [
  // ── suscriptores_newsletter ──────────────────────────────────────────────
  {
    name: 'suscriptores_newsletter',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: '',      // cualquiera puede suscribirse (público)
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'email', type: 'email', required: true, presentable: true },
      { name: 'fecha_suscripcion', type: 'date', required: false },
      { name: 'activo', type: 'bool', required: false },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_suscriptores_email ON suscriptores_newsletter (email)',
    ],
  },

  // ── servicios ────────────────────────────────────────────────────────────
  // Contratos y números de referencia de cada servicio por propiedad
  {
    name: 'servicios',
    type: 'base',
    listRule: '@request.auth.id != "" && usuario = @request.auth.id',
    viewRule: '@request.auth.id != "" && usuario = @request.auth.id',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != "" && usuario = @request.auth.id',
    deleteRule: '@request.auth.id != "" && usuario = @request.auth.id',
    fields: [
      { name: 'tipo',              type: 'text',     required: true,  max: 50  },
      { name: 'proveedor',         type: 'text',     required: false, max: 100 },
      { name: 'numero_referencia', type: 'text',     required: true,  max: 100 },
      { name: 'notas',             type: 'text',     required: false, max: 500 },
      {
        name: 'propiedad', type: 'relation', required: false,
        collectionId: 'pbc_2399486087',
        maxSelect: 1, minSelect: 0, cascadeDelete: false,
      },
      {
        name: 'usuario', type: 'relation', required: true,
        collectionId: '_pb_users_auth_',
        maxSelect: 1, minSelect: 0, cascadeDelete: false,
      },
    ],
  },

  // ── documentos_pagos ─────────────────────────────────────────────────────
  // Bóveda documental: PDFs/imágenes de pagos anteriores y programación de siguientes pagos
  {
    name: 'documentos_pagos',
    type: 'base',
    listRule: '@request.auth.id != "" && usuario = @request.auth.id',
    viewRule: '@request.auth.id != "" && usuario = @request.auth.id',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != "" && usuario = @request.auth.id',
    deleteRule: '@request.auth.id != "" && usuario = @request.auth.id',
    fields: [
      { name: 'titulo',         type: 'text',   required: false, max: 200 },
      { name: 'archivo',        type: 'file',   required: true,  maxSelect: 1, maxSize: 15728640, mimeTypes: ['application/pdf','image/jpeg','image/png','image/webp'] },
      { name: 'categoria',      type: 'text',   required: false, max: 50 },
      { name: 'proveedor',      type: 'text',   required: false, max: 100 },
      { name: 'referencia',     type: 'text',   required: false, max: 100 },
      { name: 'monto',          type: 'number', required: false },
      { name: 'fecha_pago',     type: 'date',   required: false },
      { name: 'periodicidad',   type: 'text',   required: false, max: 30 },
      { name: 'proximo_pago',   type: 'date',   required: false },
      { name: 'texto_extraido', type: 'editor', required: false },
      { name: 'extraido_auto',  type: 'bool',   required: false },
      { name: 'notas',          type: 'text',   required: false, max: 500 },
      {
        name: 'propiedad', type: 'relation', required: true,
        collectionId: 'pbc_2399486087',
        maxSelect: 1, minSelect: 0, cascadeDelete: false,
      },
      {
        name: 'usuario', type: 'relation', required: true,
        collectionId: '_pb_users_auth_',
        maxSelect: 1, minSelect: 0, cascadeDelete: false,
      },
    ],
  },
];

// Campos a agregar a colecciones existentes
// Formato: { collection: 'nombre', fields: [...] }
const PATCH_FIELDS = [
  {
    collection: 'pagos',
    fields: [
      {
        name: 'linea_captura',
        type: 'text',
        required: false,
        max: 100,
        min: 0,
        pattern: '',
        presentable: false,
        primaryKey: false,
        system: false,
      },
    ],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔑 Autenticando en ${PB_URL}...`);
  const token = await getToken();
  console.log('✅ Autenticado como superuser\n');

  const existing = await getCollections(token);
  const existingNames = new Set(existing.map((c) => c.name));

  // Crear colecciones nuevas
  for (const schema of COLLECTIONS) {
    if (existingNames.has(schema.name)) {
      console.log(`⏭️  "${schema.name}" ya existe — omitiendo creación`);
      continue;
    }
    console.log(`📦 Creando colección "${schema.name}"...`);
    const result = await createCollection(token, schema);
    if (result.id) {
      console.log(`✅ "${schema.name}" creada (id: ${result.id})`);
    } else {
      console.error(`❌ Error al crear "${schema.name}":`, JSON.stringify(result, null, 2));
    }
  }

  // Parchear colecciones existentes con campos nuevos
  for (const { collection, fields: newFields } of PATCH_FIELDS) {
    const col = existing.find((c) => c.name === collection);
    if (!col) {
      console.warn(`⚠️  Colección "${collection}" no encontrada — omitiendo patch`);
      continue;
    }

    const currentNames = new Set((col.fields || []).map((f) => f.name));
    const toAdd = newFields.filter((f) => !currentNames.has(f.name));

    if (toAdd.length === 0) {
      console.log(`⏭️  "${collection}" ya tiene todos los campos — omitiendo patch`);
      continue;
    }

    console.log(`🔧 Agregando campos a "${collection}": ${toAdd.map((f) => f.name).join(', ')}`);
    const updated = await patchCollection(token, collection, {
      fields: [...(col.fields || []), ...toAdd],
    });

    if (updated.id) {
      const names = (updated.fields || []).map((f) => f.name);
      console.log(`✅ "${collection}" actualizada. Campos: ${names.join(', ')}`);
    } else {
      console.error(`❌ Error al parchear "${collection}":`, JSON.stringify(updated, null, 2));
    }
  }

  console.log('\n🎉 Setup completado.\n');
}

main().catch((err) => {
  console.error('💥 Error fatal:', err.message);
  process.exit(1);
});
