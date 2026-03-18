/**
 * Motor de consulta predial.
 * Recibe los datos de la propiedad, busca el portal correcto,
 * intenta scraping automático y devuelve resultado o fallback manual.
 */

import type { ConsultaResult } from './types';
import { PORTALES } from './portales';
import { normalize } from './html';

// Timeout en ms para consultas automáticas (CF Workers tiene límite de 30s)
const SCRAPER_TIMEOUT_MS = 9_000;

/**
 * Busca el portal que corresponde a un estado+ciudad.
 * Prioridad: match exacto de municipio → match parcial → match de estado
 */
export function buscarPortal(estado: string, ciudad: string) {
  const ne = normalize(estado);
  const nc = normalize(ciudad);

  // Aliases de CDMX
  const esCDMX =
    nc.includes('ciudaddemexico') || nc.includes('cdmx') || nc.includes('distritofederal') ||
    ne.includes('ciudaddemexico') || ne.includes('cdmx') || ne.includes('distritofederal') ||
    nc.includes('alvaro') || nc.includes('azcapotzalco') || nc.includes('benitojuarez') ||
    nc.includes('coyoacan') || nc.includes('cuauhtemoc') || nc.includes('iztapalapa') ||
    nc.includes('tlalpan') || nc.includes('xochimilco');
  if (esCDMX) return PORTALES.find(p => p.id === 'cdmx')!;

  // 1) Match exacto de municipio
  for (const p of PORTALES) {
    for (const m of p.municipios) {
      if (normalize(m) === nc) return p;
    }
  }

  // 2) Match parcial de municipio
  for (const p of PORTALES) {
    for (const m of p.municipios) {
      const nm = normalize(m);
      if (nc && (nc.includes(nm) || nm.includes(nc))) return p;
    }
  }

  // 3) Primer portal del estado
  for (const p of PORTALES) {
    if (normalize(p.estado) === ne) return p;
  }

  return null;
}

/**
 * Consulta el predial de una propiedad.
 * SIEMPRE devuelve un ConsultaResult con info del portal,
 * aunque el scraping falle.
 */
export async function consultarPredial(
  estado: string,
  ciudad: string,
  ref: string,
): Promise<ConsultaResult> {
  const portal = buscarPortal(estado, ciudad);
  const now    = new Date().toISOString();

  // ── Portal no encontrado ───────────────────────────────────────────────
  if (!portal) {
    const q = encodeURIComponent(`predial ${ciudad} ${estado} pago en linea`);
    return {
      ok: false,
      adeudos: [],
      total_adeudo: 0,
      portal: {
        url: `https://www.google.com/search?q=${q}`,
        nombre: `Municipio de ${ciudad}, ${estado}`,
        campo_busqueda: 'Clave catastral o cuenta predial',
        instrucciones: [
          `No tenemos el portal de ${ciudad}, ${estado} en nuestro directorio.`,
          'Haz clic en "IR AL PORTAL" para buscarlo en Google.',
          'Generalmente lo administra el Ayuntamiento o la Tesorería Municipal.',
        ],
      },
      consultado_en: now,
      scraper_disponible: false,
    };
  }

  // ── Info base del portal (siempre presente) ────────────────────────────
  const portalInfo: ConsultaResult['portal'] = {
    url:             portal.portal_url,
    nombre:          portal.portal_nombre,
    campo_busqueda:  portal.campo_busqueda,
    instrucciones:   portal.instrucciones,
  };

  const base: ConsultaResult = {
    ok: false,
    adeudos: [],
    total_adeudo: 0,
    portal: portalInfo,
    consultado_en: now,
    scraper_disponible: !!portal.consultar,
  };

  // ── Sin scraper → devolver portal info ────────────────────────────────
  if (!portal.consultar) {
    return base;
  }

  // ── Intentar scraping con timeout ─────────────────────────────────────
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Tiempo de espera agotado (9s)')), SCRAPER_TIMEOUT_MS),
  );

  try {
    const scraperResult = await Promise.race([
      portal.consultar(ref),
      timeout,
    ]) as Partial<ConsultaResult>;

    // El scraper corrió, pero quizás no encontró datos
    return {
      ...base,
      ...scraperResult,
      ok:           scraperResult.ok ?? (scraperResult.adeudos?.length ?? 0) > 0,
      adeudos:      scraperResult.adeudos      ?? [],
      total_adeudo: scraperResult.total_adeudo ?? 0,
      portal:       portalInfo,   // siempre preservar el portal original
      consultado_en: now,
      scraper_disponible: true,
    };
  } catch (err) {
    // Scraper falló → devolver portal info con mensaje amigable
    const msg = (err as Error).message || 'Error desconocido';
    const esCFError = msg.toLowerCase().includes('internal error') || msg.includes('reference =');
    const errorMsg  = esCFError
      ? 'El portal gubernamental bloqueó la consulta automática desde nuestra plataforma. Usa el enlace directo.'
      : `Consulta automática no disponible: ${msg}`;

    return {
      ...base,
      scraper_error: errorMsg,
      scraper_disponible: true,
    };
  }
}
