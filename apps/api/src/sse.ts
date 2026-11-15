/**
 * GET /v1/s/:slug/orders/:id/events — order status as server-sent events.
 * Polls `orders.get` server-side and pushes `event: order` when status/paymentStatus changes, a heartbeat comment
 * every 15 s, and closes after 10 minutes (the client reconnects or falls back to polling).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Actor, Backend } from '@dokonim/db';

export interface SseOptions {
  pollMs: number;
  heartbeatMs: number;
  maxMs: number;
}

export const DEFAULT_SSE: SseOptions = { pollMs: 2_000, heartbeatMs: 15_000, maxMs: 10 * 60_000 };

interface OrderView {
  id: string;
  shortId?: string;
  status: string;
  paymentStatus: string;
}

const snapshot = (o: OrderView) => ({ id: o.id, shortId: o.shortId, status: o.status, paymentStatus: o.paymentStatus });

export async function streamOrderEvents(
  backend: Backend,
  actor: Actor,
  input: { slug: string; id: string },
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SseOptions,
  /** Open streams register their closer here so shutdown can end them (hijacked sockets block server.close()). */
  open?: Set<() => void>,
): Promise<void> {
  const get = () => backend.methods['orders.get'](actor, input) as Promise<OrderView>;
  // Resolve before hijacking so NOT_FOUND / UNAUTHENTICATED still go through the normal JSON error path.
  const first = await get();

  reply.hijack();
  const raw = reply.raw;
  const headers: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string | number | string[];
  raw.writeHead(200, {
    ...headers,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  let closed = false;
  let last = '';
  let eventId = 0;
  const send = (o: OrderView) => {
    const data = JSON.stringify(snapshot(o));
    const key = `${o.status}|${o.paymentStatus}`;
    if (key === last) return;
    last = key;
    raw.write(`id: ${++eventId}\nevent: order\ndata: ${data}\n\n`);
  };
  raw.write('retry: 3000\n\n');
  send(first);

  let polling = false;
  const poll = setInterval(() => {
    if (closed || polling) return;
    polling = true;
    get()
      .then(send)
      .catch((e: unknown) => {
        if (closed) return;
        const code = (e as { code?: string }).code ?? 'INTERNAL';
        raw.write(`event: error\ndata: ${JSON.stringify({ code })}\n\n`);
        close();
      })
      .finally(() => {
        polling = false;
      });
  }, opts.pollMs);
  const beat = setInterval(() => {
    if (!closed) raw.write(': ping\n\n');
  }, opts.heartbeatMs);
  const stop = setTimeout(() => close(), opts.maxMs);

  open?.add(close);
  function close() {
    if (closed) return;
    closed = true;
    open?.delete(close);
    clearInterval(poll);
    clearInterval(beat);
    clearTimeout(stop);
    if (!raw.writableEnded) raw.end();
  }
  req.raw.on('close', close);
  raw.on('close', close);
}
