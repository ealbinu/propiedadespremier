import type { APIRoute } from 'astro';
import { createAuthenticatedPB } from '../../lib/pocketbase';
import { chat } from '../../lib/chat-engine';

export const POST: APIRoute = async ({ request }) => {
  const pb = createAuthenticatedPB(request.headers.get('cookie') || '');
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return new Response(JSON.stringify({ reply: 'No autenticado', attachments: [], panelData: { propiedades: [], pagos: [], documentos: [] } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = pb.authStore.record;
  const userId = user.id;
  const userName = user.name || user.email?.split('@')[0] || 'Usuario';

  // Read env: Vite define (build-time) is the primary source
  const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
    DOCUMENT_AI_MODEL: process.env.DOCUMENT_AI_MODEL || '',
  };

  try {
    const body = await request.json() as { messages: any[]; documentId?: string };
    const result = await chat({ messages: body.messages, documentId: body.documentId }, pb, userId, userName, env);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      reply: `Error: ${(err as Error).message}`,
      attachments: [],
      panelData: { propiedades: [], pagos: [], documentos: [] },
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
