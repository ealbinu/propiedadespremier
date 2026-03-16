import type { APIRoute } from 'astro';
import { createPocketBase, getAuthCookieValue } from '../../../lib/pocketbase';

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const email = formData.get('email')?.toString() || '';
  const password = formData.get('password')?.toString() || '';

  if (!email || !password) {
    return redirect('/signin?error=Correo y contraseña son requeridos');
  }

  const pb = createPocketBase();

  try {
    await pb.collection('users').authWithPassword(email, password);
    const cookie = getAuthCookieValue(pb);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/dashboard',
        'Set-Cookie': cookie,
      },
    });
  } catch {
    return redirect('/signin?error=Credenciales incorrectas');
  }
};
