# Document AI Proxy

Microservicio para extraer datos de recibos de pago (PDF + imágenes/fotos) usando OCR + IA.

## Flujo

1. Recibe `fileUrl` de un documento subido a PocketBase
2. **OCR.space** extrae texto (funciona con PDF e imágenes)
3. **OpenAI/OpenRouter** estructura el texto en JSON
4. Si OCR falla y es imagen, usa **visión directa**
5. Devuelve JSON normalizado al app principal

## Deploy

### Railway / Render
1. Crea un nuevo servicio apuntando a `services/document-ai/`
2. Root directory: `services/document-ai`
3. Build command: (ninguno, no hay dependencias)
4. Start command: `node index.mjs`
5. Configura las variables de entorno (ver `.env.example`)

### Docker
```bash
cd services/document-ai
docker build -t document-ai .
docker run -p 8790:8790 --env-file .env document-ai
```

### Local
```bash
cd services/document-ai
cp .env.example .env
# Edita .env con tus keys
node index.mjs
```

## Endpoint

```
POST /extract
Content-Type: application/json
Authorization: Bearer {DOCUMENT_AI_TOKEN}  # si configuraste token

{
  "fileUrl": "https://..../archivo.pdf",
  "fileName": "recibo_cfe.pdf",
  "mimeType": "application/pdf",
  "propertyName": "Casa Roma",
  "city": "Ciudad de México",
  "state": "CDMX"
}
```

### Respuesta
```json
{
  "categoria": "cfe",
  "proveedor": "CFE",
  "referencia": "1234567890",
  "monto": 842.50,
  "fecha_pago": "2026-03-15",
  "periodicidad": "bimestral",
  "confidence": 0.91,
  "texto_extraido": "Resumen del documento..."
}
```

## Conectar al proyecto principal

En el `.env` del proyecto Astro:
```env
DOCUMENT_AI_WEBHOOK_URL=https://tu-servicio.railway.app/extract
DOCUMENT_AI_WEBHOOK_TOKEN=tu_token
```

## Sin dependencias externas
Solo usa Node.js nativo (http, fetch). No necesita `npm install`.
