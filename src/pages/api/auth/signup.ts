import type { APIRoute } from 'astro';
import { createPocketBase, getAuthCookieValue } from '../../../lib/pocketbase';

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const name = formData.get('name')?.toString() || '';
  const email = formData.get('email')?.toString() || '';
  const phone = formData.get('phone')?.toString() || '';
  const password = formData.get('password')?.toString() || '';
  const passwordConfirm = formData.get('passwordConfirm')?.toString() || '';

  if (!name || !email || !password || !passwordConfirm) {
    return redirect('/signup?error=Todos los campos obligatorios son requeridos');
  }

  if (password !== passwordConfirm) {
    return redirect('/signup?error=Las contraseñas no coinciden');
  }

  if (password.length < 8) {
    return redirect('/signup?error=La contraseña debe tener al menos 8 caracteres');
  }

  const pb = createPocketBase();

  try {
    await pb.collection('users').create({
      name,
      email,
      phone,
      password,
      passwordConfirm,
    });

    // Auto login after registration
    await pb.collection('users').authWithPassword(email, password);
    const cookie = getAuthCookieValue(pb);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/dashboard',
        'Set-Cookie': cookie,
      },
    });
  } catch (err: any) {
    const message = err?.response?.message || 'Error al crear la cuenta';
    return redirect(`/signup?error=${encodeURIComponent(message)}`);
  }
};
