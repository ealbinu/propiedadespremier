import type { APIRoute } from 'astro';
import { createAuthenticatedPB } from '../../../lib/pocketbase';
import { consultarPredial } from '../../../lib/predial/consulta';

export const POST: APIRoute = async ({ request }) => {
  // ── Autenticar ──────────────────────────────────────────────────────────
  const pb = createAuthenticatedPB(request.headers.get('cookie') || '');
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = pb.authStore.record.id;

  // ── Leer body ───────────────────────────────────────────────────────────
  let body: { propiedad_id?: string; estado?: string; ciudad?: string; numero_referencia?: string; solo_portal?: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Body JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let estado = body.estado || '';
  let ciudad = body.ciudad || '';
  let ref = body.numero_referencia || '';

  // ── Si se envía propiedad_id, cargar datos de PB ──────────────────────
  if (body.propiedad_id) {
    try {
      const prop = await pb.collection('propiedades').getOne(body.propiedad_id);
      if (prop.propietario !== userId) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      estado = estado || prop.estado || '';
      ciudad = ciudad || prop.ciudad || '';

      // Buscar servicio de tipo "predial" de esta propiedad
      if (!ref) {
        try {
          const sResult = await pb.collection('servicios').getList(1, 1, {
            filter: `propiedad = "${body.propiedad_id}" && usuario = "${userId}" && tipo = "predial"`,
          });
          if (sResult.items.length > 0) {
            ref = sResult.items[0].numero_referencia || '';
          }
        } catch { /* no servicios */ }
      }
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Propiedad no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Validaciones ────────────────────────────────────────────────────────
  if (!estado && !ciudad) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Se requiere estado y ciudad. Completa los datos de tu propiedad.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!ref) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Se requiere número de referencia (clave catastral). Registra el servicio de Predial en tu propiedad.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Si solo se pide info del portal (no scraping) ─────────────────────
  if (body.solo_portal) {
    const { buscarPortal } = await import('../../../lib/predial/consulta');
    const portal = buscarPortal(estado, ciudad);
    if (portal) {
      return new Response(JSON.stringify({
        ok: false,
        portal: {
          url:            portal.portal_url,
          nombre:         portal.portal_nombre,
          campo_busqueda: portal.campo_busqueda,
          instrucciones:  portal.instrucciones,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, portal: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Consultar ───────────────────────────────────────────────────────────
  const result = await consultarPredial(estado, ciudad, ref);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
