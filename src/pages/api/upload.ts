import type { APIRoute } from 'astro';
import { createAuthenticatedPB } from '../../lib/pocketbase';
import { extractDocumentData, inferCategoria, inferProveedor } from '../../lib/document-ai';

export const POST: APIRoute = async ({ request }) => {
  const pb = createAuthenticatedPB(request.headers.get('cookie') || '');
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = pb.authStore.record.id;

  try {
    const formData = await request.formData();
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Archivo requerido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const filename = archivo.name || 'recibo';
    const categoria = inferCategoria(filename);
    const proveedor = inferProveedor(filename) || null;

    // Save to PocketBase first
    const fd = new FormData();
    fd.append('titulo', filename);
    fd.append('archivo', archivo);
    fd.append('categoria', categoria);
    if (proveedor) fd.append('proveedor', proveedor);
    fd.append('periodicidad', 'unico');
    fd.append('extraido_auto', 'false');
    fd.append('usuario', userId);
    // propiedad left empty - will be assigned by chat AI

    const doc = await pb.collection('documentos_pagos').create(fd);
    const fileUrl = pb.files.getURL(doc, doc.archivo);

    // Try AI extraction
    let extracted: any = {};
    try {
      extracted = await extractDocumentData({
        fileUrl,
        fileName: filename,
        mimeType: archivo.type || '',
      });
    } catch {}

    // Update with extracted data
    const updates: any = {};
    if (extracted.categoria) updates.categoria = extracted.categoria;
    if (extracted.proveedor) updates.proveedor = extracted.proveedor;
    if (extracted.referencia) updates.referencia = extracted.referencia;
    if (extracted.monto) updates.monto = extracted.monto;
    if (extracted.fecha_pago) updates.fecha_pago = extracted.fecha_pago;
    if (extracted.periodicidad) updates.periodicidad = extracted.periodicidad;
    if (extracted.texto_extraido) updates.texto_extraido = extracted.texto_extraido;
    if (extracted.metodo && extracted.metodo !== 'heuristic') updates.extraido_auto = true;

    if (Object.keys(updates).length > 0) {
      await pb.collection('documentos_pagos').update(doc.id, updates);
    }

    const final = { ...doc, ...updates };

    return new Response(JSON.stringify({
      ok: true,
      document: final,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: (err as Error).message,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
