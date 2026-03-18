/**
 * Directorio de portales de predial municipales de México.
 *
 * Cada entrada incluye:
 *   - URL del portal para consulta manual
 *   - Campo y formato que necesita el ciudadano
 *   - Instrucciones paso a paso
 *   - (Opcional) Función `consultar` que intenta scraping automático
 *
 * NOTA: Los scrapers son frágiles por naturaleza — los portales de gobierno
 * cambian sin aviso. Si un scraper falla, el usuario siempre recibe
 * el link al portal + instrucciones para consulta manual.
 */

import type { PortalConfig, ConsultaResult, AdeudoPredial } from './types';
import { extractTableRows, stripTags, parseMonto, between, byId } from './html';

// ═════════════════════════════════════════════════════════════════════════════
//  SCRAPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch con timeout y proxy opcional.
 *
 * Si existe process.env.PREDIAL_PROXY_URL, el request se envía al proxy:
 *   POST {proxy}/fetch
 *   { url, method, headers, body }
 */
async function fetchWithTimeout(url: string, opts: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  const proxyUrl = process.env.PREDIAL_PROXY_URL?.trim();
  const proxyToken = process.env.PREDIAL_PROXY_TOKEN?.trim();

  try {
    if (proxyUrl) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (proxyToken) headers['Authorization'] = `Bearer ${proxyToken}`;

      const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/fetch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          method: opts.method || 'GET',
          headers: opts.headers || {},
          body: typeof opts.body === 'string' ? opts.body : null,
          redirect: opts.redirect || 'follow',
          timeoutMs: ms,
        }),
        signal: ctrl.signal,
      });
      return res;
    }

    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * CDMX — Secretaría de Administración y Finanzas
 * Portal: https://ovica.finanzas.cdmx.gob.mx
 * Campo: Cuenta predial / boleta predial
 */
async function scraperCDMX(ref: string): Promise<Partial<ConsultaResult>> {
  const cuenta = ref.replace(/\s/g, '');

  // Intento 1: Portal OVICA
  try {
    const res = await fetchWithTimeout(
      'https://ovica.finanzas.cdmx.gob.mx/Predial/Consulta',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Origin': 'https://ovica.finanzas.cdmx.gob.mx',
          'Referer': 'https://ovica.finanzas.cdmx.gob.mx/Predial/',
        },
        body: `cuenta=${encodeURIComponent(cuenta)}`,
        redirect: 'follow',
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsearHTMLPredialCDMX(await res.text(), cuenta);
  } catch (e1) {
    // Intento 2: Portal antiguo
    try {
      const res = await fetchWithTimeout(
        'https://data.finanzas.cdmx.gob.mx/adeudos_predial/adeudo_predial.php',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          body: `cuenta=${encodeURIComponent(cuenta)}`,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parsearHTMLPredialCDMX(await res.text(), cuenta);
    } catch {
      throw new Error(`Portal CDMX no accesible: ${(e1 as Error).message}`);
    }
  }
}

function parsearHTMLPredialCDMX(html: string, cuenta: string): Partial<ConsultaResult> {
  const adeudos: AdeudoPredial[] = [];
  const now = new Date();

  // Buscar propietario
  let propietario: string | undefined;
  const propRe = /propietario[^:]*:\s*<[^>]*>([^<]+)/i;
  const pm = html.match(propRe);
  if (pm) propietario = stripTags(pm[1]).toUpperCase();

  // Buscar dirección catastral
  let direccion_catastral: string | undefined;
  const dirRe = /ubicaci[oó]n[^:]*:\s*<[^>]*>([^<]+)/i;
  const dm = html.match(dirRe);
  if (dm) direccion_catastral = stripTags(dm[1]);

  // Buscar valor catastral
  let valor_catastral: number | undefined;
  const valRe = /valor\s+catastral[^:]*:\s*[\$]?([\d,\.]+)/i;
  const vm = html.match(valRe);
  if (vm) valor_catastral = parseMonto(vm[1]);

  // Buscar tablas de adeudo
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = extractTableRows(table);
    for (const row of rows) {
      // Buscar filas con datos numéricos (montos)
      const hasMontos = row.some(c => /\$[\d,]/.test(c) || /[\d,]+\.\d{2}/.test(c));
      if (!hasMontos || row.length < 3) continue;

      // Intentar extraer datos de la fila
      const periodo = row[0] || '';
      const concepto = row.length > 4 ? row[1] : `Predial ${periodo}`;
      const montos = row.map(c => parseMonto(c)).filter(n => n > 0);

      if (montos.length >= 1) {
        const total = montos[montos.length - 1]; // El último monto suele ser el total
        const base = montos.length > 1 ? montos[0] : total;
        const recargos = montos.length > 2 ? montos[1] : 0;

        adeudos.push({
          periodo: periodo.replace(/\s+/g, ' ').trim(),
          concepto: concepto.replace(/\s+/g, ' ').trim() || `Predial ${periodo}`,
          monto_base: base,
          recargos,
          descuento: 0,
          total,
          vencido: /vencid|adeud|anterior/i.test(periodo + concepto) || parseInt(periodo) < now.getFullYear(),
        });
      }
    }
  }

  // Buscar línea de captura global
  let linea_captura_global: string | undefined;
  const lcRe = /l[ií]nea\s+de\s+captura[^:]*:\s*<?[^>]*>?\s*([A-Z0-9\-\s]{10,})/i;
  const lcm = html.match(lcRe);
  if (lcm) linea_captura_global = lcm[1].replace(/\s+/g, '').trim();

  // Si no encontró nada pero hay contenido, buscar patrón alternativo
  if (adeudos.length === 0) {
    // Buscar "Total a pagar" o "Monto" directo
    const totalRe = /total\s*(?:a\s+pagar|adeudo)[^$]*\$\s*([\d,\.]+)/i;
    const tm = html.match(totalRe);
    if (tm) {
      const total = parseMonto(tm[1]);
      if (total > 0) {
        adeudos.push({
          periodo: `${now.getFullYear()}`,
          concepto: `Predial ${now.getFullYear()}`,
          monto_base: total,
          recargos: 0,
          descuento: 0,
          total,
          vencido: false,
        });
      }
    }
  }

  // Buscar descuento por pronto pago
  let descuento_pronto_pago: ConsultaResult['descuento_pronto_pago'];
  const descRe = /descuento[^:]*:\s*(\d+)\s*%/i;
  const descM = html.match(descRe);
  if (descM) {
    const pct = parseInt(descM[1]);
    const total = adeudos.reduce((s, a) => s + a.total, 0);
    descuento_pronto_pago = {
      porcentaje: pct,
      vigencia: `${now.getFullYear()}-01-31`,
      total_con_descuento: Math.round(total * (1 - pct / 100) * 100) / 100,
    };
  }

  const total_adeudo = adeudos.reduce((s, a) => s + a.total, 0);

  return {
    ok: adeudos.length > 0 || !!propietario,
    propietario,
    direccion_catastral,
    clave_catastral: cuenta,
    valor_catastral,
    adeudos,
    total_adeudo,
    descuento_pronto_pago,
    linea_captura_global,
  };
}

/**
 * MONTERREY, NL — Tesorería Municipal
 * Portal: https://servicios.monterrey.gob.mx/predial
 * Campo: Clave catastral
 */
async function scraperMonterrey(ref: string): Promise<Partial<ConsultaResult>> {
  const clave = ref.replace(/\s/g, '');
  const res = await fetchWithTimeout(
    'https://servicios.monterrey.gob.mx/recaudacion/predial/consulta',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0', 'Origin': 'https://servicios.monterrey.gob.mx' },
      body: `clave_catastral=${encodeURIComponent(clave)}`, redirect: 'follow' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsearHTMLGenerico(await res.text(), clave);
}

/**
 * GUADALAJARA, JAL — Gobierno Municipal
 * Portal: https://pagos.guadalajara.gob.mx
 * Campo: Cuenta catastral
 */
async function scraperGuadalajara(ref: string): Promise<Partial<ConsultaResult>> {
  const cuenta = ref.replace(/\s/g, '');
  const res = await fetchWithTimeout(
    'https://pagos.guadalajara.gob.mx/predial/consulta',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0', 'Origin': 'https://pagos.guadalajara.gob.mx' },
      body: `cuenta=${encodeURIComponent(cuenta)}`, redirect: 'follow' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsearHTMLGenerico(await res.text(), cuenta);
}

/**
 * QUERÉTARO — Gobierno Municipal
 */
async function scraperQueretaro(ref: string): Promise<Partial<ConsultaResult>> {
  const clave = ref.replace(/\s/g, '');
  const res = await fetchWithTimeout(
    'https://pagos.municipiodequeretaro.gob.mx/predial/consulta',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0' },
      body: `clave=${encodeURIComponent(clave)}`, redirect: 'follow' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsearHTMLGenerico(await res.text(), clave);
}

/**
 * Parser genérico para portales que devuelven HTML con tablas estándar.
 * Intenta extraer propietario, adeudos y líneas de captura con patrones comunes.
 */
function parsearHTMLGenerico(html: string, ref: string): Partial<ConsultaResult> {
  const adeudos: AdeudoPredial[] = [];
  const now = new Date();

  // Propietario — buscar en varios formatos comunes
  let propietario: string | undefined;
  for (const re of [
    /propietario[^:]*:\s*<[^>]*>([^<]+)/i,
    /contribuyente[^:]*:\s*<[^>]*>([^<]+)/i,
    /nombre[^:]*:\s*<[^>]*>([^<]+)/i,
  ]) {
    const m = html.match(re);
    if (m) { propietario = stripTags(m[1]).toUpperCase(); break; }
  }

  // Dirección
  let direccion_catastral: string | undefined;
  for (const re of [
    /ubicaci[oó]n[^:]*:\s*<[^>]*>([^<]+)/i,
    /direcci[oó]n[^:]*:\s*<[^>]*>([^<]+)/i,
    /domicilio[^:]*:\s*<[^>]*>([^<]+)/i,
  ]) {
    const m = html.match(re);
    if (m) { direccion_catastral = stripTags(m[1]); break; }
  }

  // Valor catastral
  let valor_catastral: number | undefined;
  const valRe = /valor\s+catastral[^$]*\$\s*([\d,\.]+)/i;
  const vm = html.match(valRe);
  if (vm) valor_catastral = parseMonto(vm[1]);

  // Tablas de adeudo
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = extractTableRows(table);

    // Buscar el encabezado para identificar la tabla correcta
    const header = rows[0] || [];
    const headerText = header.join(' ').toLowerCase();
    const isPredialTable = /periodo|año|bimestre|concepto|impuesto|adeudo|predial|monto/i.test(headerText);

    if (!isPredialTable && rows.length > 0) continue;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const hasMontos = row.some(c => /[\d,]+\.?\d*/.test(c) && parseMonto(c) > 0);
      if (!hasMontos || row.length < 2) continue;

      const periodo = row[0] || '';
      const montos = row.map(c => parseMonto(c)).filter(n => n > 0);
      if (montos.length === 0) continue;

      const total = montos[montos.length - 1];
      const base = montos.length > 1 ? montos[0] : total;
      const recargos = montos.length > 2 ? montos[1] : 0;

      // Buscar línea de captura en la fila
      let linea_captura: string | undefined;
      for (const cell of row) {
        if (/^[A-Z0-9\-]{15,}$/.test(cell.replace(/\s/g, ''))) {
          linea_captura = cell.replace(/\s/g, '');
        }
      }

      adeudos.push({
        periodo: periodo.trim(),
        concepto: `Predial ${periodo.trim()}`,
        monto_base: base,
        recargos,
        descuento: 0,
        total,
        linea_captura,
        vencido: parseInt(periodo) < now.getFullYear(),
      });
    }
  }

  // Línea de captura global
  let linea_captura_global: string | undefined;
  const lcRe = /l[ií]nea\s*(?:de\s*)?captura[^:]*:?\s*<?[^>]*>?\s*([A-Z0-9\-]{10,})/i;
  const lcm = html.match(lcRe);
  if (lcm) linea_captura_global = lcm[1].replace(/\s/g, '');

  // Total global
  let total_adeudo = adeudos.reduce((s, a) => s + a.total, 0);

  // Si no encontró tabla pero hay un total directo
  if (adeudos.length === 0) {
    const totalRe = /total[^$]*\$\s*([\d,\.]+)/i;
    const tm = html.match(totalRe);
    if (tm) {
      const t = parseMonto(tm[1]);
      if (t > 0) {
        total_adeudo = t;
        adeudos.push({
          periodo: `${now.getFullYear()}`,
          concepto: `Predial ${now.getFullYear()}`,
          monto_base: t, recargos: 0, descuento: 0, total: t,
          linea_captura: linea_captura_global,
          vencido: false,
        });
      }
    }
  }

  return {
    ok: adeudos.length > 0 || !!propietario,
    propietario,
    direccion_catastral,
    clave_catastral: ref,
    valor_catastral,
    adeudos,
    total_adeudo,
    linea_captura_global,
  };
}


// ═════════════════════════════════════════════════════════════════════════════
//  DIRECTORIO DE PORTALES
// ═════════════════════════════════════════════════════════════════════════════

export const PORTALES: PortalConfig[] = [

  // ── CDMX ───────────────────────────────────────────────────────────────────
  {
    id: 'cdmx',
    estado: 'Ciudad de México',
    municipios: ['Ciudad de México', 'CDMX', 'México D.F.', 'Distrito Federal',
      'Álvaro Obregón', 'Azcapotzalco', 'Benito Juárez', 'Coyoacán', 'Cuajimalpa',
      'Cuauhtémoc', 'Gustavo A. Madero', 'Iztacalco', 'Iztapalapa', 'Magdalena Contreras',
      'Miguel Hidalgo', 'Milpa Alta', 'Tláhuac', 'Tlalpan', 'Venustiano Carranza', 'Xochimilco'],
    portal_url: 'https://ovica.finanzas.cdmx.gob.mx/Predial/',
    portal_nombre: 'Finanzas CDMX — OVICA',
    campo_busqueda: 'Cuenta predial (boleta)',
    formato: 'Numérico, varía según alcaldía',
    ejemplo: '049 124 03 000',
    instrucciones: [
      'Ingresa a ovica.finanzas.cdmx.gob.mx/Predial',
      'Escribe tu cuenta predial (aparece en tu boleta)',
      'Da clic en "Consultar"',
      'El sistema muestra adeudos con línea de captura',
      'Puedes pagar en línea, banco o tienda de conveniencia',
    ],
    consultar: scraperCDMX,
  },

  // ── MONTERREY, NL ──────────────────────────────────────────────────────────
  {
    id: 'monterrey',
    estado: 'Nuevo León',
    municipios: ['Monterrey'],
    portal_url: 'https://servicios.monterrey.gob.mx/predial/',
    portal_nombre: 'Tesorería Municipal de Monterrey',
    campo_busqueda: 'Clave catastral',
    formato: 'XX-XXX-XXX',
    ejemplo: '01-234-567',
    instrucciones: [
      'Ingresa a servicios.monterrey.gob.mx/predial',
      'Escribe tu clave catastral',
      'Da clic en "Consultar"',
      'Se muestra el adeudo con línea de captura',
      'Puedes pagar en línea o en ventanilla bancaria',
    ],
    consultar: scraperMonterrey,
  },

  // ── SAN PEDRO GARZA GARCÍA, NL ────────────────────────────────────────────
  {
    id: 'sanpedro',
    estado: 'Nuevo León',
    municipios: ['San Pedro Garza García', 'San Pedro', 'San Pedro Garza Garcia'],
    portal_url: 'https://www.sanpedro.gob.mx/predial/',
    portal_nombre: 'Gobierno de San Pedro Garza García',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa a sanpedro.gob.mx/predial',
      'Introduce tu clave catastral',
      'Consulta tu adeudo',
      'Genera tu línea de captura para pago',
    ],
  },

  // ── GUADALAJARA, JAL ───────────────────────────────────────────────────────
  {
    id: 'guadalajara',
    estado: 'Jalisco',
    municipios: ['Guadalajara'],
    portal_url: 'https://pagos.guadalajara.gob.mx/predial/',
    portal_nombre: 'Pagos Guadalajara',
    campo_busqueda: 'Cuenta catastral',
    ejemplo: '12345678',
    instrucciones: [
      'Ingresa a pagos.guadalajara.gob.mx',
      'Selecciona "Predial"',
      'Escribe tu cuenta catastral',
      'Consulta adeudos y genera línea de captura',
    ],
    consultar: scraperGuadalajara,
  },

  // ── ZAPOPAN, JAL ──────────────────────────────────────────────────────────
  {
    id: 'zapopan',
    estado: 'Jalisco',
    municipios: ['Zapopan'],
    portal_url: 'https://finanzas.zapopan.gob.mx/predial/',
    portal_nombre: 'Finanzas Zapopan',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa a finanzas.zapopan.gob.mx',
      'Busca la sección de Predial',
      'Escribe tu cuenta predial',
      'Consulta adeudos y genera línea de captura',
    ],
  },

  // ── TLAQUEPAQUE, JAL ───────────────────────────────────────────────────────
  {
    id: 'tlaquepaque',
    estado: 'Jalisco',
    municipios: ['Tlaquepaque', 'San Pedro Tlaquepaque'],
    portal_url: 'https://www.tlaquepaque.gob.mx/pagos',
    portal_nombre: 'Gobierno de Tlaquepaque',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa al portal de pagos de Tlaquepaque',
      'Busca la sección de impuesto predial',
      'Escribe tu cuenta predial',
    ],
  },

  // ── PUEBLA, PUE ───────────────────────────────────────────────────────────
  {
    id: 'puebla',
    estado: 'Puebla',
    municipios: ['Puebla', 'Heroica Puebla de Zaragoza'],
    portal_url: 'https://sfa.puebla.gob.mx/recaudacion/predial',
    portal_nombre: 'Secretaría de Finanzas de Puebla',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa a sfa.puebla.gob.mx',
      'Selecciona "Predial"',
      'Escribe tu clave catastral',
      'Consulta tu adeudo y genera línea de captura',
    ],
  },

  // ── QUERÉTARO, QRO ─────────────────────────────────────────────────────────
  {
    id: 'queretaro',
    estado: 'Querétaro',
    municipios: ['Querétaro', 'Santiago de Querétaro', 'Queretaro'],
    portal_url: 'https://pagos.municipiodequeretaro.gob.mx/',
    portal_nombre: 'Municipio de Querétaro — Pagos en línea',
    campo_busqueda: 'Clave catastral',
    ejemplo: '01-00-00-00-000-000',
    instrucciones: [
      'Ingresa a pagos.municipiodequeretaro.gob.mx',
      'Selecciona "Impuesto Predial"',
      'Ingresa tu clave catastral',
      'Consulta adeudos y descarga tu línea de captura',
    ],
    consultar: scraperQueretaro,
  },

  // ── MÉRIDA, YUC ───────────────────────────────────────────────────────────
  {
    id: 'merida',
    estado: 'Yucatán',
    municipios: ['Mérida'],
    portal_url: 'https://servicios.merida.gob.mx/catastro/',
    portal_nombre: 'Servicios Mérida',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa a servicios.merida.gob.mx/catastro',
      'Busca "Consulta de adeudo predial"',
      'Ingresa tu clave catastral',
      'Genera tu formato de pago',
    ],
  },

  // ── LEÓN, GTO ──────────────────────────────────────────────────────────────
  {
    id: 'leon',
    estado: 'Guanajuato',
    municipios: ['León', 'Leon'],
    portal_url: 'https://pagos.leon.gob.mx/',
    portal_nombre: 'Pagos León',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa a pagos.leon.gob.mx',
      'Selecciona "Impuesto Predial"',
      'Escribe tu cuenta predial',
      'Consulta tu adeudo',
    ],
  },

  // ── TIJUANA, BC ────────────────────────────────────────────────────────────
  {
    id: 'tijuana',
    estado: 'Baja California',
    municipios: ['Tijuana'],
    portal_url: 'https://www.tijuana.gob.mx/pagos',
    portal_nombre: 'Gobierno de Tijuana',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa al portal de pagos de Tijuana',
      'Selecciona "Predial"',
      'Ingresa tu cuenta predial',
      'Consulta y paga en línea',
    ],
  },

  // ── CANCÚN (BENITO JUÁREZ), QR ────────────────────────────────────────────
  {
    id: 'cancun',
    estado: 'Quintana Roo',
    municipios: ['Cancún', 'Benito Juárez', 'Cancun', 'Benito Juarez'],
    portal_url: 'https://predial.cancun.gob.mx/',
    portal_nombre: 'Predial Benito Juárez (Cancún)',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa a predial.cancun.gob.mx',
      'Ingresa tu clave catastral',
      'Consulta adeudos y genera referencia de pago',
    ],
  },

  // ── AGUASCALIENTES, AGS ───────────────────────────────────────────────────
  {
    id: 'aguascalientes',
    estado: 'Aguascalientes',
    municipios: ['Aguascalientes'],
    portal_url: 'https://www.ags.gob.mx/tramites/predial/',
    portal_nombre: 'Gobierno de Aguascalientes',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal de trámites de Aguascalientes',
      'Busca "Predial"',
      'Ingresa tu clave catastral',
      'Consulta tu adeudo',
    ],
  },

  // ── SAN LUIS POTOSÍ, SLP ──────────────────────────────────────────────────
  {
    id: 'slp',
    estado: 'San Luis Potosí',
    municipios: ['San Luis Potosí', 'San Luis Potosi'],
    portal_url: 'https://www.sanluis.gob.mx/predial/',
    portal_nombre: 'Gobierno de San Luis Potosí',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del gobierno de SLP',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
      'Consulta tu adeudo',
    ],
  },

  // ── CHIHUAHUA, CHIH ───────────────────────────────────────────────────────
  {
    id: 'chihuahua',
    estado: 'Chihuahua',
    municipios: ['Chihuahua'],
    portal_url: 'https://predial.municipiochihuahua.gob.mx/',
    portal_nombre: 'Gobierno Municipal de Chihuahua',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa a predial.municipiochihuahua.gob.mx',
      'Escribe tu clave catastral',
      'Consulta adeudos y genera línea de captura',
    ],
  },

  // ── JUÁREZ, CHIH ──────────────────────────────────────────────────────────
  {
    id: 'juarez',
    estado: 'Chihuahua',
    municipios: ['Juárez', 'Ciudad Juárez', 'Juarez', 'Ciudad Juarez'],
    portal_url: 'https://www.juarez.gob.mx/predial/',
    portal_nombre: 'Gobierno Municipal de Juárez',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa al portal del gobierno de Juárez',
      'Busca "Predial"',
      'Ingresa tu cuenta predial',
    ],
  },

  // ── TOLUCA, MÉX ──────────────────────────────────────────────────────────
  {
    id: 'toluca',
    estado: 'Estado de México',
    municipios: ['Toluca', 'Toluca de Lerdo'],
    portal_url: 'https://www.toluca.gob.mx/predial/',
    portal_nombre: 'H. Ayuntamiento de Toluca',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del gobierno de Toluca',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },

  // ── NAUCALPAN, MÉX ────────────────────────────────────────────────────────
  {
    id: 'naucalpan',
    estado: 'Estado de México',
    municipios: ['Naucalpan', 'Naucalpan de Juárez', 'Naucalpan de Juarez'],
    portal_url: 'https://www.naucalpan.gob.mx/predial/',
    portal_nombre: 'Gobierno de Naucalpan',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa al portal de Naucalpan',
      'Busca "Predial"',
      'Ingresa tu cuenta predial',
    ],
  },

  // ── HERMOSILLO, SON ───────────────────────────────────────────────────────
  {
    id: 'hermosillo',
    estado: 'Sonora',
    municipios: ['Hermosillo'],
    portal_url: 'https://www.hermosillo.gob.mx/predial/',
    portal_nombre: 'Gobierno de Hermosillo',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del gobierno de Hermosillo',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },

  // ── CULIACÁN, SIN ─────────────────────────────────────────────────────────
  {
    id: 'culiacan',
    estado: 'Sinaloa',
    municipios: ['Culiacán', 'Culiacan'],
    portal_url: 'https://culiacan.gob.mx/predial/',
    portal_nombre: 'Gobierno de Culiacán',
    campo_busqueda: 'Cuenta predial',
    instrucciones: [
      'Ingresa al portal del gobierno de Culiacán',
      'Busca "Impuesto Predial"',
      'Ingresa tu cuenta predial',
    ],
  },

  // ── SALTILLO, COAH ────────────────────────────────────────────────────────
  {
    id: 'saltillo',
    estado: 'Coahuila',
    municipios: ['Saltillo'],
    portal_url: 'https://www.saltillo.gob.mx/predial/',
    portal_nombre: 'Gobierno de Saltillo',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal de Saltillo',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },

  // ── MORELIA, MICH ─────────────────────────────────────────────────────────
  {
    id: 'morelia',
    estado: 'Michoacán',
    municipios: ['Morelia'],
    portal_url: 'https://www.morelia.gob.mx/predial/',
    portal_nombre: 'H. Ayuntamiento de Morelia',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del gobierno de Morelia',
      'Busca "Predial"',
      'Ingresa tu clave catastral',
    ],
  },

  // ── CUERNAVACA, MOR ───────────────────────────────────────────────────────
  {
    id: 'cuernavaca',
    estado: 'Morelos',
    municipios: ['Cuernavaca'],
    portal_url: 'https://www.cuernavaca.gob.mx/predial/',
    portal_nombre: 'Gobierno de Cuernavaca',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal de Cuernavaca',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },

  // ── VILLAHERMOSA (CENTRO), TAB ─────────────────────────────────────────────
  {
    id: 'villahermosa',
    estado: 'Tabasco',
    municipios: ['Villahermosa', 'Centro'],
    portal_url: 'https://www.villahermosa.gob.mx/predial/',
    portal_nombre: 'Gobierno de Centro (Villahermosa)',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del gobierno de Centro',
      'Busca "Impuesto Predial"',
      'Ingresa tu clave catastral',
    ],
  },

  // ── TUXTLA GUTIÉRREZ, CHIS ────────────────────────────────────────────────
  {
    id: 'tuxtla',
    estado: 'Chiapas',
    municipios: ['Tuxtla Gutiérrez', 'Tuxtla Gutierrez', 'Tuxtla'],
    portal_url: 'https://www.tuxtla.gob.mx/predial/',
    portal_nombre: 'Gobierno de Tuxtla Gutiérrez',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal de Tuxtla Gutiérrez',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },

  // ── OAXACA, OAX ───────────────────────────────────────────────────────────
  {
    id: 'oaxaca',
    estado: 'Oaxaca',
    municipios: ['Oaxaca', 'Oaxaca de Juárez', 'Oaxaca de Juarez'],
    portal_url: 'https://www.municipiodeoaxaca.gob.mx/predial',
    portal_nombre: 'Gobierno de Oaxaca de Juárez',
    campo_busqueda: 'Clave catastral',
    instrucciones: [
      'Ingresa al portal del municipio de Oaxaca',
      'Busca la sección de Predial',
      'Ingresa tu clave catastral',
    ],
  },
];
