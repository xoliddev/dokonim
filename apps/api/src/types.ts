import type { Actor } from '@dokonim/db';

declare module 'fastify' {
  interface FastifyRequest {
    /** Actor from a valid bearer token (null = anonymous). Set by the onRequest auth hook. */
    actor: Actor | null;
    /** A bearer token was sent but is invalid/expired. */
    badToken: boolean;
  }
}

export {};
