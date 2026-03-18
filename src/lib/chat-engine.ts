/**
 * Motor de chat con IA para Propiedades Premier.
 * Usa OpenAI function calling para ejecutar acciones sobre PocketBase.
 */

import type PocketBase from 'pocketbase';
import { extractDocumentData } from './document-ai';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvVars {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  DOCUMENT_AI_MODEL?: string;
}

export interface ChatRequest {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  documentId?: string;
}

export interface ChatAttachment {
  type: 'property' | 'payment' | 'document' | 'payments_list' | 'properties_list' | 'calendar';
  data: any;
}

export interface ChatResponse {
  reply: string;
  attachments: ChatAttachment[];
  panelData: {
    propiedades: any[];
    pagos: any[];
    documentos: any[];
  };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: any[] = [
  {
    type: 'function',
    function: {
      name: 'crear_propiedad',
      description: 'Crea una nueva propiedad inmobiliaria del usuario',
      parameters: {
        type: 'object',
        properties: {
          nombre:    { type: 'string', description: 'Nombre o alias de la propiedad' },
          direccion: { type: 'string', description: 'Dirección completa' },
          ciudad:    { type: 'string', description: 'Ciudad o municipio' },
          estado:    { type: 'string', description: 'Estado de México' },
          tipo:      { type: 'string', enum: ['casa','departamento','terreno','local','oficina','bodega','otro'] },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_propiedades',
      description: 'Lista todas las propiedades del usuario. Usa SOLO cuando el usuario pida ver todas sus propiedades.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_propiedad',
      description: 'Obtiene detalles de UNA propiedad específica. Usa esto cuando el usuario pregunte por una propiedad en particular.',
      parameters: {
        type: 'object',
        properties: {
          propiedad_id: { type: 'string', description: 'ID de la propiedad' },
          nombre: { type: 'string', description: 'Nombre de la propiedad (se busca por coincidencia)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'procesar_recibo',
      description: 'Procesa un recibo/comprobante subido y lo asigna a una propiedad. Extrae datos y programa pagos.',
      parameters: {
        type: 'object',
        properties: {
          document_id:   { type: 'string', description: 'ID del documento subido' },
          propiedad_id:  { type: 'string', description: 'ID de la propiedad a la que se asigna. Si no existe, usa crear_propiedad primero.' },
          categoria:     { type: 'string', enum: ['predial','cfe','agua','gas','internet','telefono','condominio','seguro','hipoteca','otro'] },
          proveedor:     { type: 'string' },
          monto:         { type: 'number' },
          fecha_pago:    { type: 'string', description: 'YYYY-MM-DD' },
          periodicidad:  { type: 'string', enum: ['unico','mensual','bimestral','trimestral','semestral','anual'] },
          referencia:    { type: 'string', description: 'Número de referencia/contrato' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_pagos',
      description: 'Lista pagos pendientes del usuario, opcionalmente filtrados por propiedad',
      parameters: {
        type: 'object',
        properties: {
          propiedad_id: { type: 'string', description: 'Filtrar por propiedad (opcional)' },
          mostrar_todos: { type: 'boolean', description: 'Incluir pagados también' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_pago',
      description: 'Crea un pago pendiente manualmente',
      parameters: {
        type: 'object',
        properties: {
          concepto:          { type: 'string' },
          monto:             { type: 'number' },
          fecha_vencimiento: { type: 'string', description: 'YYYY-MM-DD' },
          propiedad_id:      { type: 'string' },
          linea_captura:     { type: 'string' },
        },
        required: ['concepto', 'monto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'guardar_referencia',
      description: 'Guarda un número de referencia, cuenta, contrato o clave catastral asociado a una propiedad. Úsalo cuando el usuario te dé un número de predial, CFE, agua, internet, etc. NO necesita crear un pago.',
      parameters: {
        type: 'object',
        properties: {
          propiedad_id: { type: 'string', description: 'ID de la propiedad' },
          tipo:         { type: 'string', enum: ['predial','cfe','agua','gas_natural','gas_lp','internet','telefono','condominio','seguro','hipoteca','cable','vigilancia','otro'], description: 'Tipo de servicio' },
          numero_referencia: { type: 'string', description: 'El número de cuenta, clave catastral, número de servicio, etc.' },
          proveedor:    { type: 'string', description: 'Nombre del proveedor (CFE, SACMEX, Telmex, Municipio, etc.)' },
          notas:        { type: 'string', description: 'Notas adicionales opcionales' },
        },
        required: ['propiedad_id', 'tipo', 'numero_referencia'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'marcar_pagado',
      description: 'Marca un pago como pagado',
      parameters: {
        type: 'object',
        properties: {
          pago_id: { type: 'string' },
        },
        required: ['pago_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_calendario',
      description: 'Muestra el calendario de pagos próximos a 12 meses',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

const PERIODO_MESES: Record<string, number | null> = {
  unico: null, mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
};

async function executeTool(
  name: string,
  args: any,
  pb: PocketBase,
  userId: string,
): Promise<{ result: string; attachment?: ChatAttachment }> {
  try {
    switch (name) {
      case 'crear_propiedad': {
        const prop = await pb.collection('propiedades').create({
          nombre: args.nombre,
          direccion: args.direccion || '',
          ciudad: args.ciudad || '',
          estado: args.estado || '',
          tipo: args.tipo || 'casa',
          propietario: userId,
          estatus: 'activa',
        });
        return {
          result: `Propiedad "${prop.nombre}" creada (id: ${prop.id})`,
          attachment: { type: 'property', data: prop },
        };
      }

      case 'listar_propiedades': {
        const r = await pb.collection('propiedades').getList(1, 50, {
          filter: `propietario = "${userId}"`,
          sort: 'nombre',
        });
        return {
          result: r.items.length > 0
            ? `${r.items.length} propiedades: ${r.items.map((p: any) => `${p.nombre} (${p.id})`).join(', ')}`
            : 'No tiene propiedades registradas.',
          attachment: { type: 'properties_list', data: r.items },
        };
      }

      case 'ver_propiedad': {
        let prop: any = null;
        if (args.propiedad_id) {
          try { prop = await pb.collection('propiedades').getOne(args.propiedad_id); } catch {}
        }
        if (!prop && args.nombre) {
          const r = await pb.collection('propiedades').getList(1, 50, {
            filter: `propietario = "${userId}"`,
          });
          const nombre = args.nombre.toLowerCase();
          prop = r.items.find((p: any) => p.nombre.toLowerCase().includes(nombre));
        }
        if (!prop) return { result: 'No encontré esa propiedad.' };

        // Get payments, docs and service references for this property
        const [pagosR, docsR, servR] = await Promise.all([
          pb.collection('pagos').getList(1, 20, { filter: `propiedad = "${prop.id}" && usuario = "${userId}" && estatus != "pagado"`, sort: 'fecha_vencimiento' }).catch(() => ({ items: [] })),
          pb.collection('documentos_pagos').getList(1, 20, { filter: `propiedad = "${prop.id}" && usuario = "${userId}"` }).catch(() => ({ items: [] })),
          pb.collection('servicios').getList(1, 50, { filter: `propiedad = "${prop.id}" && usuario = "${userId}"` }).catch(() => ({ items: [] })),
        ]);

        const tipoLabels: Record<string, string> = {
          predial: 'Predial', cfe: 'Luz (CFE)', agua: 'Agua', gas_natural: 'Gas Natural',
          gas_lp: 'Gas LP', internet: 'Internet', telefono: 'Teléfono', condominio: 'Condominio',
          seguro: 'Seguro', hipoteca: 'Hipoteca', cable: 'Cable/TV', vigilancia: 'Vigilancia', otro: 'Otro',
        };

        const detail = [
          `Propiedad: ${prop.nombre} (${prop.tipo || 'propiedad'})`,
          `Dirección: ${prop.direccion || 'sin dirección'}`,
          prop.ciudad || prop.estado ? `Ubicación: ${[prop.ciudad, prop.estado].filter(Boolean).join(', ')}` : '',
          servR.items.length > 0 ? `\nReferencias guardadas:` : '',
          ...servR.items.map((s: any) => `  - ${tipoLabels[s.tipo] || s.tipo}: ${s.numero_referencia}${s.proveedor ? ` (${s.proveedor})` : ''}`),
          `\nPagos pendientes: ${pagosR.items.length}`,
          pagosR.items.length > 0 ? pagosR.items.map((p: any) => `  - ${p.concepto}: $${p.monto || 0} (vence ${p.fecha_vencimiento?.slice(0,10) || '?'})`).join('\n') : '',
          `Recibos guardados: ${docsR.items.length}`,
        ].filter(Boolean).join('\n');

        return {
          result: detail,
          attachment: { type: 'property', data: prop },
        };
      }

      case 'procesar_recibo': {
        const doc = await pb.collection('documentos_pagos').getOne(args.document_id);
        const updates: any = {};
        if (args.propiedad_id) updates.propiedad = args.propiedad_id;
        if (args.categoria) updates.categoria = args.categoria;
        if (args.proveedor) updates.proveedor = args.proveedor;
        if (args.monto) updates.monto = args.monto;
        if (args.fecha_pago) updates.fecha_pago = args.fecha_pago;
        if (args.periodicidad) updates.periodicidad = args.periodicidad;
        if (args.referencia) updates.referencia = args.referencia;

        const periodo = args.periodicidad || doc.periodicidad || 'unico';
        const fechaPago = args.fecha_pago || doc.fecha_pago || new Date().toISOString().slice(0, 10);
        const months = PERIODO_MESES[periodo];
        if (months) updates.proximo_pago = addMonths(fechaPago, months);

        const updated = await pb.collection('documentos_pagos').update(args.document_id, updates);

        // Create payment if recurrent
        const monto = args.monto || doc.monto || 0;
        const proximoPago = updates.proximo_pago || doc.proximo_pago;
        let pagoCreado = false;
        if (periodo !== 'unico' && proximoPago && monto > 0 && (args.propiedad_id || doc.propiedad)) {
          const cat = args.categoria || doc.categoria || 'otro';
          const prov = args.proveedor || doc.proveedor || '';
          const concepto = `${cat.charAt(0).toUpperCase() + cat.slice(1)}${prov ? ` - ${prov}` : ''}`;
          await pb.collection('pagos').create({
            concepto,
            monto,
            fecha_vencimiento: proximoPago,
            propiedad: args.propiedad_id || doc.propiedad,
            usuario: userId,
            estatus: 'pendiente',
            linea_captura: args.referencia || doc.referencia || null,
          });
          pagoCreado = true;
        }

        return {
          result: `Recibo procesado: ${updated.titulo || updated.archivo}. ${pagoCreado ? 'Próximo pago programado.' : ''}`,
          attachment: { type: 'document', data: updated },
        };
      }

      case 'listar_pagos': {
        const filters = [`usuario = "${userId}"`];
        if (args.propiedad_id) filters.push(`propiedad = "${args.propiedad_id}"`);
        if (!args.mostrar_todos) filters.push('estatus != "pagado"');
        const r = await pb.collection('pagos').getList(1, 50, {
          filter: filters.join(' && '),
          sort: 'fecha_vencimiento',
          expand: 'propiedad',
        });
        const total = r.items.reduce((s: number, p: any) => s + (p.monto || 0), 0);
        return {
          result: r.items.length > 0
            ? `${r.items.length} pagos. Total: $${total.toLocaleString('es-MX')}`
            : 'No hay pagos pendientes.',
          attachment: { type: 'payments_list', data: r.items },
        };
      }

      case 'crear_pago': {
        const pago = await pb.collection('pagos').create({
          concepto: args.concepto,
          monto: args.monto,
          fecha_vencimiento: args.fecha_vencimiento || null,
          propiedad: args.propiedad_id || null,
          usuario: userId,
          estatus: 'pendiente',
          linea_captura: args.linea_captura || null,
        });
        return {
          result: `Pago "${pago.concepto}" por $${args.monto} creado.`,
          attachment: { type: 'payment', data: pago },
        };
      }

      case 'guardar_referencia': {
        // Check if already exists for this property+type
        const existing = await pb.collection('servicios').getList(1, 1, {
          filter: `propiedad = "${args.propiedad_id}" && usuario = "${userId}" && tipo = "${args.tipo}"`,
        }).catch(() => ({ items: [] as any[] }));

        let servicio: any;
        if (existing.items.length > 0) {
          // Update existing
          servicio = await pb.collection('servicios').update(existing.items[0].id, {
            numero_referencia: args.numero_referencia,
            proveedor: args.proveedor || existing.items[0].proveedor || null,
            notas: args.notas || existing.items[0].notas || null,
          });
        } else {
          // Create new
          servicio = await pb.collection('servicios').create({
            tipo: args.tipo,
            numero_referencia: args.numero_referencia,
            proveedor: args.proveedor || null,
            notas: args.notas || null,
            propiedad: args.propiedad_id,
            usuario: userId,
          });
        }

        const tipoLabels: Record<string, string> = {
          predial: 'Predial', cfe: 'Luz (CFE)', agua: 'Agua', gas_natural: 'Gas Natural',
          gas_lp: 'Gas LP', internet: 'Internet', telefono: 'Teléfono', condominio: 'Condominio',
          seguro: 'Seguro', hipoteca: 'Hipoteca', cable: 'Cable/TV', vigilancia: 'Vigilancia', otro: 'Otro',
        };
        return {
          result: `Referencia de ${tipoLabels[args.tipo] || args.tipo} guardada: ${args.numero_referencia}${existing.items.length > 0 ? ' (actualizada)' : ' (nueva)'}`,
        };
      }

      case 'marcar_pagado': {
        const pago = await pb.collection('pagos').update(args.pago_id, {
          estatus: 'pagado',
          fecha_pago: new Date().toISOString(),
        });
        return { result: `Pago "${pago.concepto}" marcado como pagado.` };
      }

      case 'ver_calendario': {
        const filters = [`usuario = "${userId}"`, 'estatus != "pagado"'];
        const r = await pb.collection('pagos').getList(1, 100, {
          filter: filters.join(' && '),
          sort: 'fecha_vencimiento',
          expand: 'propiedad',
        });
        return {
          result: r.items.length > 0
            ? `Calendario: ${r.items.length} pagos próximos.`
            : 'Calendario vacío.',
          attachment: { type: 'calendar', data: r.items },
        };
      }

      default:
        return { result: `Función desconocida: ${name}` };
    }
  } catch (err) {
    return { result: `Error ejecutando ${name}: ${(err as Error).message}` };
  }
}

// ─── Main chat function ───────────────────────────────────────────────────────

async function loadPanelData(pb: PocketBase, userId: string) {
  const [propsR, pagosR, docsR] = await Promise.all([
    pb.collection('propiedades').getList(1, 50, { filter: `propietario = "${userId}"`, sort: 'nombre' }).catch(() => ({ items: [] })),
    pb.collection('pagos').getList(1, 50, { filter: `usuario = "${userId}" && estatus != "pagado"`, sort: 'fecha_vencimiento', expand: 'propiedad' }).catch(() => ({ items: [] })),
    pb.collection('documentos_pagos').getList(1, 50, { filter: `usuario = "${userId}"` }).catch(() => ({ items: [] })),
  ]);
  return {
    propiedades: propsR.items,
    pagos: pagosR.items,
    documentos: docsR.items,
  };
}

export async function chat(
  req: ChatRequest,
  pb: PocketBase,
  userId: string,
  userName: string,
  env: EnvVars = {},
): Promise<ChatResponse> {
  const apiKey = env.OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = (env.OPENAI_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.DOCUMENT_AI_MODEL?.trim() || process.env.DOCUMENT_AI_MODEL?.trim() || 'gpt-4o-mini';

  if (!apiKey) {
    return {
      reply: 'El asistente de IA no está configurado. Configura OPENAI_API_KEY en las variables de entorno.',
      attachments: [],
      panelData: await loadPanelData(pb, userId),
    };
  }

  // Build context
  const panel = await loadPanelData(pb, userId);
  const propsSummary = panel.propiedades.length > 0
    ? panel.propiedades.map((p: any) => `- ${p.nombre} (id:${p.id}) ${p.direccion} ${p.ciudad}, ${p.estado}`).join('\n')
    : 'Sin propiedades registradas.';
  const pagosSummary = panel.pagos.length > 0
    ? panel.pagos.slice(0, 10).map((p: any) => `- ${p.concepto}: $${p.monto} vence ${p.fecha_vencimiento?.slice(0,10) || '?'} (id:${p.id})`).join('\n')
    : 'Sin pagos pendientes.';

  // If there's a newly uploaded document, include its data
  let docContext = '';
  if (req.documentId) {
    try {
      const doc = await pb.collection('documentos_pagos').getOne(req.documentId);
      docContext = `\n\nEl usuario acaba de subir un documento:
- ID: ${doc.id}
- Archivo: ${doc.archivo}
- Categoría detectada: ${doc.categoria || 'no detectada'}
- Proveedor: ${doc.proveedor || 'no detectado'}
- Monto: ${doc.monto || 'no detectado'}
- Referencia: ${doc.referencia || 'no detectada'}
- Periodicidad: ${doc.periodicidad || 'no detectada'}
- Texto extraído: ${(doc.texto_extraido || '').slice(0, 500)}

Analiza esta información y decide:
1. ¿A qué propiedad pertenece? Si no hay match, sugiere crear una nueva.
2. Usa procesar_recibo con los datos correctos.
3. Informa al usuario qué encontraste y qué hiciste.`;
    } catch {}
  }

  const systemPrompt = `Eres el asistente de Propiedades Premier, plataforma de gestión inmobiliaria en México.
Tu trabajo: ayudar al usuario "${userName}" a gestionar sus propiedades, recibos y pagos.

PROPIEDADES DEL USUARIO:
${propsSummary}

PAGOS PENDIENTES:
${pagosSummary}

REGLAS:
- Habla en español mexicano, sé conciso y amable.
- Si el usuario quiere crear una propiedad, usa crear_propiedad.
- Si sube un archivo/recibo, usa procesar_recibo para asignarlo.
- Si no queda claro a qué propiedad va un recibo, pregunta o sugiere opciones.
- Para listar TODAS las propiedades, usa listar_propiedades.
- Para ver detalles de UNA propiedad específica, usa ver_propiedad. NO uses listar_propiedades para esto.
- Cuando crees algo, confirma qué hiciste.
- Sé proactivo: sugiere programar pagos, revisar vencimientos, etc.
- Usa formato markdown: **negritas**, listas con -, tablas, etc.
- No inventes datos. Si no sabes algo, pregunta.
- Responde de forma estructurada y legible.
- NO listes todas las propiedades a menos que el usuario lo pida explícitamente.${docContext}`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...req.messages.slice(-20), // últimos 20 mensajes
  ];

  // Call OpenAI
  const attachments: ChatAttachment[] = [];
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        reply: `Error del modelo de IA (${res.status}). Intenta de nuevo.`,
        attachments: [],
        panelData: panel,
      };
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (!choice) break;

    const msg = choice.message;

    // If the model wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);

      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs: any = {};
        try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

        const result = await executeTool(fnName, fnArgs, pb, userId);
        if (result.attachment) attachments.push(result.attachment);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.result,
        });
      }
      continue; // Loop back for the model to respond with the tool results
    }

    // Final text response
    const reply = msg.content || 'Listo.';
    const updatedPanel = await loadPanelData(pb, userId);
    return { reply, attachments, panelData: updatedPanel };
  }

  return {
    reply: 'No pude completar la operación. Intenta de nuevo.',
    attachments: [],
    panelData: await loadPanelData(pb, userId),
  };
}
