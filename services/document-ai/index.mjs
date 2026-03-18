#!/usr/bin/env node
/**
 * document-ai-proxy.mjs
 *
 * Microservicio Node para analizar documentos de pago (PDF + imágenes/fotos).
 *
 * Flujo:
 *   1) OCR.space intenta extraer texto desde fileUrl (sirve para PDF e imagen)
 *   2) OpenAI estructura ese texto en JSON útil para la app
 *   3) Si OCR falla y el archivo es imagen, usa visión directa con OpenAI
 *
 * Endpoint:
 *   POST /extract
 *   {
 *     fileUrl: string,
 *     fileName: string,
 *     mimeType: string,
 *     propertyName?: string,
 *     city?: string,
 *     state?: string
 *   }
 *
 * Respuesta:
 *   {
 *     categoria,
 *     proveedor,
 *     referencia,
 *     monto,
 *     fecha_pago,
 *     periodicidad,
 *     confidence,
 *     texto_extraido
 *   }
 *
 * Variables de entorno:
 *   PORT=8790
 *   DOCUMENT_AI_TOKEN=...                # opcional
 *   OCR_SPACE_API_KEY=...                # recomendado
 *   OPENAI_API_KEY=...                   # recomendado
 *   OPENAI_BASE_URL=https://api.openai.com/v1
 *   DOCUMENT_AI_MODEL=gpt-4o-mini
 */

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '8790', 10);
const TOKEN = process.env.DOCUMENT_AI_TOKEN || '';
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const DOCUMENT_AI_MODEL = process.env.DOCUMENT_AI_MODEL || 'gpt-4o-mini';

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

async function ocrSpaceExtract(fileUrl) {
  if (!OCR_SPACE_API_KEY) return null;

  const body = new URLSearchParams();
  body.set('apikey', OCR_SPACE_API_KEY);
  body.set('url', fileUrl);
  body.set('language', 'spa');
  body.set('isOverlayRequired', 'false');
  body.set('isTable', 'true');
  body.set('OCREngine', '2');
  body.set('scale', 'true');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) throw new Error(`OCR.space HTTP ${res.status}`);
  const data = await res.json();

  if (data.IsErroredOnProcessing) {
    throw new Error(data.ErrorMessage?.join?.(' ') || 'OCR error');
  }

  const text = (data.ParsedResults || [])
    .map(r => r.ParsedText || '')
    .join('\n\n')
    .trim();

  return text || null;
}

async function structureTextWithOpenAI(text, meta) {
  if (!OPENAI_API_KEY) return null;

  const prompt = `Eres un extractor de datos de recibos y comprobantes de pago de México.
Devuelve SOLO JSON válido con esta forma exacta:
{
  "categoria": "predial|cfe|agua|gas|internet|telefono|condominio|seguro|hipoteca|otro",
  "proveedor": "string|null",
  "referencia": "string|null",
  "monto": 0,
  "fecha_pago": "YYYY-MM-DD|null",
  "periodicidad": "unico|mensual|bimestral|trimestral|semestral|anual|null",
  "confidence": 0.0,
  "texto_extraido": "resumen corto"
}

Reglas:
- Usa contexto de México.
- monto debe ser número sin símbolo $.
- fecha_pago en formato YYYY-MM-DD si la puedes inferir.
- confidence entre 0 y 1.
- Si no sabes algo, usa null.

Contexto:
- Archivo: ${meta.fileName || ''}
- MIME: ${meta.mimeType || ''}
- Propiedad: ${meta.propertyName || ''}
- Ciudad: ${meta.city || ''}
- Estado: ${meta.state || ''}

Texto OCR:
${text.slice(0, 18000)}`;

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DOCUMENT_AI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI text HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return safeJson(content);
}

async function visionExtractWithOpenAI(fileUrl, meta) {
  if (!OPENAI_API_KEY) return null;

  const prompt = `Analiza este recibo o comprobante mexicano y devuelve SOLO JSON válido con esta forma:
{
  "categoria": "predial|cfe|agua|gas|internet|telefono|condominio|seguro|hipoteca|otro",
  "proveedor": "string|null",
  "referencia": "string|null",
  "monto": 0,
  "fecha_pago": "YYYY-MM-DD|null",
  "periodicidad": "unico|mensual|bimestral|trimestral|semestral|anual|null",
  "confidence": 0.0,
  "texto_extraido": "resumen corto"
}

Contexto:
- Archivo: ${meta.fileName || ''}
- Propiedad: ${meta.propertyName || ''}
- Ciudad: ${meta.city || ''}
- Estado: ${meta.state || ''}
- Usa contexto de México.`;

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DOCUMENT_AI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: fileUrl } },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI vision HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return safeJson(content);
}

function cleanResult(obj, fallbackText = '') {
  if (!obj || typeof obj !== 'object') return null;
  return {
    categoria: obj.categoria || 'otro',
    proveedor: obj.proveedor || null,
    referencia: obj.referencia || null,
    monto: typeof obj.monto === 'number' ? obj.monto : (obj.monto ? parseFloat(String(obj.monto).replace(/[$,\s]/g, '')) : null),
    fecha_pago: normalizeDate(obj.fecha_pago),
    periodicidad: obj.periodicidad || null,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
    texto_extraido: obj.texto_extraido || fallbackText || '',
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.end();

  // Health check
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return sendJson(res, 200, {
      ok: true,
      service: 'document-ai-proxy',
      ocr: !!OCR_SPACE_API_KEY,
      ai: !!OPENAI_API_KEY,
    });
  }

  if (req.method !== 'POST' || req.url !== '/extract') {
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  if (TOKEN) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${TOKEN}`) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }
  }

  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const { fileUrl, fileName = '', mimeType = '', propertyName = '', city = '', state = '' } = body;

      if (!fileUrl || typeof fileUrl !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'fileUrl requerido' });
      }

      const meta = { fileUrl, fileName, mimeType, propertyName, city, state };
      const isImage = String(mimeType).toLowerCase().startsWith('image/');

      // 1) OCR.space primero (sirve para pdf + imagen)
      try {
        const text = await ocrSpaceExtract(fileUrl);
        if (text) {
          const structured = await structureTextWithOpenAI(text, meta);
          const cleaned = cleanResult(structured, text);
          if (cleaned) return sendJson(res, 200, cleaned);
          return sendJson(res, 200, cleanResult({ categoria: 'otro', confidence: 0.4, texto_extraido: text }, text));
        }
      } catch (e) {
        // sigue al fallback de visión si es imagen
      }

      // 2) Si es imagen, visión directa
      if (isImage) {
        try {
          const vision = await visionExtractWithOpenAI(fileUrl, meta);
          const cleaned = cleanResult(vision);
          if (cleaned) return sendJson(res, 200, cleaned);
        } catch (e) {
          // cae al final
        }
      }

      return sendJson(res, 200, {
        categoria: 'otro',
        proveedor: null,
        referencia: null,
        monto: null,
        fecha_pago: null,
        periodicidad: null,
        confidence: 0.1,
        texto_extraido: '',
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Document AI proxy escuchando en http://localhost:${PORT}`);
});
