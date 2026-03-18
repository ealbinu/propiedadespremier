/**
 * Utilidades de parsing HTML para scrapers de portales gubernamentales.
 * No usamos librerías externas para mantener el bundle ligero en CF Workers.
 */

/** Decodifica entidades HTML básicas */
export function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Quita todas las etiquetas HTML y normaliza espacios */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Extrae texto entre dos marcadores (inclusivo del contenido, exclusivo de marcadores) */
export function between(html: string, start: string, end: string): string | null {
  const s = html.indexOf(start);
  if (s === -1) return null;
  const e = html.indexOf(end, s + start.length);
  if (e === -1) return null;
  return html.slice(s + start.length, e);
}

/** Extrae el contenido de un tag por su id */
export function byId(html: string, id: string): string | null {
  // Busca <ANY id="X" ... >CONTENT</ANY>
  const regex = new RegExp(`id=["']${id}["'][^>]*>([\\s\\S]*?)(?:<\\/|$)`, 'i');
  const m = html.match(regex);
  return m ? m[1] : null;
}

/** Extrae filas de una tabla HTML como arrays de strings limpios */
export function extractTableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      cells.push(stripTags(cm[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Extrae el valor de un input hidden por su name */
export function hiddenInput(html: string, name: string): string | null {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  // Try reverse order (value before name)
  const re2 = new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

/** Parsea un string de monto MXN a number: "$1,234.56" → 1234.56 */
export function parseMonto(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Normaliza string para comparación: quita acentos, lowercase, solo alfanumérico */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
