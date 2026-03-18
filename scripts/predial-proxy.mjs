/**
 * predial-proxy.mjs
 *
 * Microservicio HTTP para realizar fetches a portales gubernamentales desde
 * un servidor normal (no Cloudflare). El Worker de Astro le manda la URL destino
 * y este proxy regresa el body/raw response.
 *
 * Uso local:
 *   node scripts/predial-proxy.mjs
 *
 * Variables opcionales:
 *   PORT=8788
 *   PROXY_TOKEN=secreto-opcional
 *
 * Endpoint:
 *   POST /fetch
 *   {
 *     url: string,
 *     method: 'GET'|'POST',
 *     headers: object,
 *     body: string|null,
 *     redirect: 'follow'|'manual',
 *     timeoutMs: number
 *   }
 *
 * Respuesta:
 *   status: mismo status del upstream
 *   body: texto upstream
 */

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '8788', 10);
const TOKEN = process.env.PROXY_TOKEN || '';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS básico para pruebas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.end();

  if (req.method !== 'POST' || req.url !== '/fetch') {
    return json(res, 404, { ok: false, error: 'Not found' });
  }

  if (TOKEN) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${TOKEN}`) {
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }
  }

  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const { url, method = 'GET', headers = {}, body: requestBody = null, redirect = 'follow', timeoutMs = 8000 } = body;

      if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        return json(res, 400, { ok: false, error: 'Invalid URL' });
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const upstream = await fetch(url, {
          method,
          headers,
          body: requestBody,
          redirect,
          signal: ctrl.signal,
        });

        const text = await upstream.text();
        clearTimeout(timer);

        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
          'X-Upstream-Status': String(upstream.status),
        });
        res.end(text);
      } catch (err) {
        clearTimeout(timer);
        return json(res, 502, {
          ok: false,
          error: err instanceof Error ? err.message : 'Upstream fetch failed',
        });
      }
    } catch (err) {
      return json(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Predial proxy escuchando en http://localhost:${PORT}`);
});
