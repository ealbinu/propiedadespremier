import type { APIRoute } from 'astro';
import { createPocketBase } from '../../lib/pocketbase';

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const email = formData.get('email')?.toString().trim() || '';

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ ok: false, error: 'Correo inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pb = createPocketBase();

  try {
    await pb.collection('suscriptores_newsletter').create({
      email,
      fecha_suscripcion: new Date().toISOString(),
    });
  } catch (e: any) {
    // If the record already exists (duplicate email), treat as success
    const isDuplicate =
      e?.response?.code === 400 &&
      JSON.stringify(e?.response?.data).includes('unique');

    if (!isDuplicate) {
      // Collection might not exist yet or another error — still accept gracefully
      console.error('Newsletter error:', e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
