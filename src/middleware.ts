import { defineMiddleware } from 'astro:middleware';
import { createAuthenticatedPB } from './lib/pocketbase';

const protectedRoutes = ['/dashboard', '/propiedades', '/pagos', '/perfil', '/alertas'];

export const onRequest = defineMiddleware(async (context, next) => {
  const pb = createAuthenticatedPB(context.request.headers.get('cookie') || '');

  // Make pb and user available to all pages
  context.locals.pb = pb;
  context.locals.user = pb.authStore.isValid ? pb.authStore.record : null;

  // Protect private routes
  const isProtected = protectedRoutes.some(route => context.url.pathname.startsWith(route));
  if (isProtected && !pb.authStore.isValid) {
    return context.redirect('/signin');
  }

  // Redirect authenticated users away from auth pages
  const authPages = ['/signin', '/signup'];
  if (authPages.includes(context.url.pathname) && pb.authStore.isValid) {
    return context.redirect('/dashboard');
  }

  const response = await next();
  return response;
});
