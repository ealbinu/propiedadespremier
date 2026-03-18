/**
 * Tipos para el sistema de consulta de predial.
 *
 * Arquitectura:
 *   1. El usuario tiene una propiedad con estado/ciudad y un servicio de tipo "predial"
 *      con su número de referencia (clave catastral, cuenta predial, etc.)
 *   2. El sistema busca en el directorio de portales el que corresponda al municipio
 *   3. Si hay scraper → consulta automática → devuelve adeudos
 *   4. Si no hay scraper → devuelve el URL del portal + instrucciones para consulta manual
 */

// ─── Adeudo individual ─────────────────────────────────────────────────────────
export interface AdeudoPredial {
  periodo: string;           // "2026", "2025", "Ene-Feb 2024"
  concepto: string;          // "Predial 2026", "Recargo 2024"
  monto_base: number;        // Monto original
  recargos: number;          // Recargos por mora
  descuento: number;         // Descuento por pronto pago
  total: number;             // Total final a pagar
  fecha_limite?: string;     // ISO date
  linea_captura?: string;    // Línea de captura bancaria
  vigencia_linea?: string;   // ISO date — vigencia de la línea de captura
  vencido: boolean;
}

// ─── Resultado de consulta ──────────────────────────────────────────────────────
export interface ConsultaResult {
  ok: boolean;

  // Datos del predio (si el portal los regresa)
  propietario?: string;
  direccion_catastral?: string;
  clave_catastral?: string;
  valor_catastral?: number;
  uso_suelo?: string;
  superficie_terreno?: number;
  superficie_construccion?: number;

  // Adeudos desglosados
  adeudos: AdeudoPredial[];
  total_adeudo: number;

  // Descuento por pronto pago (si aplica)
  descuento_pronto_pago?: {
    porcentaje: number;
    vigencia: string;       // ISO date
    total_con_descuento: number;
  };

  // Línea de captura global (si aplica)
  linea_captura_global?: string;
  vigencia_linea_global?: string;

  // Portal info (siempre presente)
  portal: {
    url: string;
    nombre: string;
    campo_busqueda: string;   // "Cuenta predial", "Clave catastral"
    instrucciones: string[];
  };

  // Meta
  consultado_en: string;        // ISO timestamp
  scraper_disponible: boolean;  // ¿Existe scraper para este municipio?
  scraper_error?: string;       // Error amigable si el scraper falló
  error?: string;               // Error de validación (falta ref, falta ciudad, etc.)
}

// ─── Configuración de un portal municipal ────────────────────────────────────
export interface PortalConfig {
  id: string;                     // Slug único: "cdmx", "monterrey", etc.
  estado: string;
  municipios: string[];           // Nombres aceptados del municipio
  portal_url: string;
  portal_nombre: string;
  campo_busqueda: string;         // "Cuenta predial", "Clave catastral"
  formato?: string;               // Formato esperado del número
  ejemplo?: string;               // Ejemplo de número válido
  instrucciones: string[];

  /** Si existe, intenta consulta automática */
  consultar?: (ref: string) => Promise<Partial<ConsultaResult>>;
}

export interface PredialRuntimeOptions {
  proxyUrl?: string;
}
