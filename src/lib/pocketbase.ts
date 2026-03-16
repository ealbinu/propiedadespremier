import PocketBase from 'pocketbase';

const PB_URL = 'https://propiedadespr.pockethost.io';

export function createPocketBase() {
  return new PocketBase(PB_URL);
}

export function createAuthenticatedPB(cookie?: string) {
  const pb = new PocketBase(PB_URL);
  if (cookie) {
    pb.authStore.loadFromCookie(cookie, 'pb_auth');
  }
  return pb;
}

export function getAuthCookieValue(pb: PocketBase): string {
  return pb.authStore.exportToCookie({ httpOnly: true, secure: true, sameSite: 'Lax' }, 'pb_auth');
}

export { PB_URL };
