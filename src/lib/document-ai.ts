export type CategoriaDoc =
  | 'predial'
  | 'cfe'
  | 'agua'
  | 'gas'
  | 'internet'
  | 'telefono'
  | 'condominio'
  | 'seguro'
  | 'hipoteca'
  | 'otro';

export interface ExtractDocumentInput {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  propertyName?: string;
  city?: string;
  state?: string;
}

export interface ExtractedDocumentData {
  categoria?: CategoriaDoc;
  proveedor?: string;
  referencia?: string;
  monto?: number;
  fecha_pago?: string;       // YYYY-MM-DD
  periodicidad?: 'unico'|'mensual'|'bimestral'|'trimestral'|'semestral'|'anual';
  confidence?: number;       // 0-1
  texto_extraido?: string;
  metodo?: 'heuristic'|'ai_image'|'ai_webhook';
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function inferCategoria(filename: string): CategoriaDoc {
  const n = normalize(filename);
  if (n.includes('predial')) return 'predial';
  if (n.includes('cfe') || n.includes('luz')) return 'cfe';
  if (n.includes('agua') || n.includes('sacmex') || n.includes('siapa')) return 'agua';
  if (n.includes('gas')) return 'gas';
  if (n.includes('telmex') || n.includes('izzi') || n.includes('totalplay') || n.includes('megacable') || n.includes('internet')) return 'internet';
  if (n.includes('telefono')) return 'telefono';
  if (n.includes('condominio') || n.includes('mantenimiento')) return 'condominio';
  if (n.includes('seguro') || n.includes('poliza')) return 'seguro';
  if (n.includes('hipoteca') || n.includes('infonavit') || n.includes('fovissste')) return 'hipoteca';
  return 'otro';
}

export function inferProveedor(filename: string) {
  const n = normalize(filename);
  if (n.includes('cfe')) return 'CFE';
  if (n.includes('sacmex')) return 'SACMEX';
  if (n.includes('siapa')) return 'SIAPA';
  if (n.includes('telmex')) return 'Telmex';
  if (n.includes('izzi')) return 'Izzi';
  if (n.includes('totalplay')) return 'TotalPlay';
  if (n.includes('megacable')) return 'Megacable';
  if (n.includes('infonavit')) return 'INFONAVIT';
  if (n.includes('fovissste')) return 'FOVISSSTE';
  if (n.includes('predial')) return 'Municipio';
  return '';
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function numberOrNull(v: any): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? undefined : n;
}

function normalizeDate(v: any): string | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  return undefined;
}

function clampCategoria(v: any): CategoriaDoc | undefined {
  const allowed: CategoriaDoc[] = ['predial','cfe','agua','gas','internet','telefono','condominio','seguro','hipoteca','otro'];
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase();
  return allowed.includes(s as CategoriaDoc) ? (s as CategoriaDoc) : undefined;
}

function clampPeriodicidad(v: any): ExtractedDocumentData['periodicidad'] {
  const allowed = ['unico','mensual','bimestral','trimestral','semestral','anual'];
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase();
  return allowed.includes(s) ? (s as any) : undefined;
}

function fallbackHeuristic(input: ExtractDocumentInput): ExtractedDocumentData {
  const categoria = inferCategoria(input.fileName);
  const proveedor = inferProveedor(input.fileName) || undefined;
  return {
    categoria,
    proveedor,
    confidence: 0.2,
    metodo: 'heuristic',
    texto_extraido: [
      `archivo: ${input.fileName}`,
      `mime: ${input.mimeType || 'desconocido'}`,
      `categoria_inferida: ${categoria}`,
      proveedor ? `proveedor_inferido: ${proveedor}` : '',
    ].filter(Boolean).join('\n'),
  };
}

async function tryWebhook(input: ExtractDocumentInput): Promise<ExtractedDocumentData | null> {
  const webhook = process.env.DOCUMENT_AI_WEBHOOK_URL?.trim();
  const token = process.env.DOCUMENT_AI_WEBHOOK_TOKEN?.trim();
  if (!webhook) return null;

  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(webhook, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Webhook AI HTTP ${res.status}`);
  const data = await res.json() as any;

  return {
    categoria: clampCategoria(data.categoria),
    proveedor: data.proveedor || undefined,
    referencia: data.referencia || undefined,
    monto: numberOrNull(data.monto),
    fecha_pago: normalizeDate(data.fecha_pago),
    periodicidad: clampPeriodicidad(data.periodicidad),
    confidence: numberOrNull(data.confidence),
    texto_extraido: data.texto_extraido || undefined,
    metodo: 'ai_webhook',
  };
}

async function tryOpenAIImage(input: ExtractDocumentInput): Promise<ExtractedDocumentData | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.DOCUMENT_AI_MODEL?.trim() || 'gpt-4o-mini';
  const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (!apiKey) return null;

  const mime = input.mimeType.toLowerCase();
  const isImage = mime.startsWith('image/');
  if (!isImage) return null;

  const prompt = `Analiza este recibo o comprobante de pago de servicios/inmueble en México.
Devuelve SOLO JSON válido con esta forma exacta:
{
  "categoria": "predial|cfe|agua|gas|internet|telefono|condominio|seguro|hipoteca|otro",
  "proveedor": "string|null",
  "referencia": "string|null",
  "monto": 0,
  "fecha_pago": "YYYY-MM-DD|null",
  "periodicidad": "unico|mensual|bimestral|trimestral|semestral|anual|null",
  "confidence": 0.0,
  "texto_extraido": "resumen corto con lo visto"
}

Reglas:
- Si no sabes algo, usa null.
- monto debe ser número sin símbolo $.
- fecha_pago en formato YYYY-MM-DD si la puedes inferir.
- periodicidad es la recurrencia probable del servicio.
- confidence entre 0 y 1.
- Usa contexto de México.
- Nombre de propiedad: ${input.propertyName || ''}
- Ciudad: ${input.city || ''}
- Estado: ${input.state || ''}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: input.fileUrl } },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json() as any;
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return null;
  const parsed = safeParseJson<any>(text);
  if (!parsed) return null;

  return {
    categoria: clampCategoria(parsed.categoria),
    proveedor: parsed.proveedor || undefined,
    referencia: parsed.referencia || undefined,
    monto: numberOrNull(parsed.monto),
    fecha_pago: normalizeDate(parsed.fecha_pago),
    periodicidad: clampPeriodicidad(parsed.periodicidad),
    confidence: numberOrNull(parsed.confidence),
    texto_extraido: parsed.texto_extraido || undefined,
    metodo: 'ai_image',
  };
}

export async function extractDocumentData(input: ExtractDocumentInput): Promise<ExtractedDocumentData> {
  // 1) Webhook externo primero (sirve para PDF+OCR o pipelines custom)
  try {
    const viaWebhook = await tryWebhook(input);
    if (viaWebhook) {
      return {
        ...fallbackHeuristic(input),
        ...viaWebhook,
      };
    }
  } catch {
    // ignore and continue fallback chain
  }

  // 2) IA multimodal para imágenes
  try {
    const viaImageAI = await tryOpenAIImage(input);
    if (viaImageAI) {
      return {
        ...fallbackHeuristic(input),
        ...viaImageAI,
      };
    }
  } catch {
    // ignore and continue fallback chain
  }

  // 3) Heurística básica
  return fallbackHeuristic(input);
}
