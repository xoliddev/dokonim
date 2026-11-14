/**
 * OpenAPI 3.1 document generated from the contract's ROUTES table (zod 4 → JSON Schema 2020-12, which OpenAPI 3.1
 * uses natively). Response bodies are inferred from the backend's TypeScript types and are not described here.
 */
import { z } from 'zod';
import { ROUTES, type RouteDef } from '@dokonim/contract';

type Json = Record<string, unknown>;

function schemaOf(t: z.ZodType): Json {
  const s = z.toJSONSchema(t, { io: 'input', unrepresentable: 'any' }) as Json;
  delete s.$schema;
  return s;
}

function without(schema: Json, keys: string[]): Json {
  const props = { ...((schema.properties as Json | undefined) ?? {}) };
  for (const k of keys) delete props[k];
  const required = ((schema.required as string[] | undefined) ?? []).filter((k) => !keys.includes(k));
  const out: Json = { ...schema, properties: props };
  if (required.length) out.required = required;
  else delete out.required;
  return out;
}

const pathKeys = (path: string) => [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
const oaPath = (path: string) => path.replace(/:([A-Za-z]+)/g, '{$1}');

const ERROR_SCHEMA: Json = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } },
  },
};

const ok = (description = 'OK'): Json => ({ description, content: { 'application/json': { schema: {} } } });
const errors = { default: { $ref: '#/components/responses/Error' } };

export function buildOpenApi(opts: { publicUrl: string }): Json {
  const paths: Record<string, Record<string, Json>> = {};
  const add = (path: string, verb: string, op: Json) => {
    (paths[path] ??= {})[verb.toLowerCase()] = op;
  };

  for (const [name, def] of Object.entries(ROUTES) as Array<[string, RouteDef]>) {
    if (def.auth === 'internal') continue;
    const schema = schemaOf(def.input);
    const props = (schema.properties as Json | undefined) ?? {};
    const keys = pathKeys(def.path);
    const parameters: Json[] = keys.map((k) => ({ name: k, in: 'path', required: true, schema: props[k] ?? { type: 'string' } }));
    const hidden = def.idempotent ? [...keys, 'idempotencyKey'] : keys;
    if (def.idempotent) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 80 } });
    const rest = without(schema, hidden);
    const op: Json = {
      operationId: name,
      tags: [name.split('.')[0]],
      security: def.auth === 'user' ? [{ bearer: [] }] : [{}, { bearer: [] }],
      parameters,
      responses: { 200: ok(), ...errors },
    };
    if (def.rateLimit) op['x-rate-limit'] = def.rateLimit;
    if (def.verb === 'GET' || def.verb === 'DELETE') {
      if (Object.keys(rest.properties as Json).length)
        parameters.push({ name: 'input', in: 'query', required: !!(rest.required as string[] | undefined)?.length, description: 'JSON-encoded input object', content: { 'application/json': { schema: rest } } });
    } else op.requestBody = { required: true, content: { 'application/json': { schema: rest } } };
    add(oaPath(def.path), def.verb, op);
  }

  const tokenPair = { type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' }, expiresIn: { type: 'integer' }, user: { type: 'object' } } };
  add('/v1/auth/telegram', 'POST', {
    operationId: 'auth.telegram',
    tags: ['auth'],
    security: [],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['initData'], properties: { initData: { type: 'string' } } } } } },
    responses: { 200: { description: 'Token pair', content: { 'application/json': { schema: tokenPair } } }, ...errors },
    'x-rate-limit': 'auth',
  });
  add('/v1/auth/refresh', 'POST', {
    operationId: 'auth.refresh',
    tags: ['auth'],
    security: [],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
    responses: { 200: { description: 'Rotated token pair', content: { 'application/json': { schema: tokenPair } } }, ...errors },
    'x-rate-limit': 'auth',
  });
  add('/v1/s/{slug}/orders/{id}/events', 'GET', {
    operationId: 'orders.events',
    tags: ['orders'],
    description: 'Server-sent events: `event: order` whenever status/paymentStatus changes. EventSource cannot set headers, so `?access_token=` is accepted.',
    security: [{ bearer: [] }],
    parameters: [
      { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'access_token', in: 'query', required: false, schema: { type: 'string' } },
    ],
    responses: { 200: { description: 'text/event-stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errors },
  });
  const hook = (provider: string, path: string, contentType: string, actions?: string[]) =>
    add(path, 'POST', {
      operationId: `hooks.${provider}`,
      tags: ['hooks'],
      security: [],
      description: `${provider} webhook (provider-specific auth, raw body).`,
      parameters: [
        { name: 'storeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ...(actions ? [{ name: 'action', in: 'path', required: true, schema: { type: 'string', enum: actions } }] : []),
      ],
      requestBody: { required: true, content: { [contentType]: { schema: {} } } },
      responses: { 200: ok('Provider-specific response') },
      'x-rate-limit': 'webhook',
    });
  hook('payme', '/hooks/payme/{storeId}', 'application/json');
  hook('click', '/hooks/click/{storeId}/{action}', 'application/x-www-form-urlencoded', ['prepare', 'complete']);
  hook('uzum', '/hooks/uzum/{storeId}/{action}', 'application/json', ['check', 'create', 'confirm', 'reverse', 'status']);
  add('/hooks/telegram', 'POST', { operationId: 'hooks.telegram', tags: ['hooks'], security: [], description: 'Bot API webhook (X-Telegram-Bot-Api-Secret-Token).', responses: { 200: ok() } });
  add('/healthz', 'GET', { operationId: 'healthz', tags: ['ops'], security: [], responses: { 200: ok(), 503: ok('Database unreachable') } });

  return {
    openapi: '3.1.0',
    info: { title: "Do'konim API", version: '1.0.0', description: 'Multi-tenant store builder for Telegram Mini Apps. Generated from @dokonim/contract.' },
    servers: [{ url: opts.publicUrl }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: ERROR_SCHEMA },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
    },
  };
}
