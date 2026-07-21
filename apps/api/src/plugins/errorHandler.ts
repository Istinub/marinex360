// Maps AppError -> the contract's HTTP status + { error: { code, message } } envelope.
// Unknown errors -> 500 with an opaque message (never leak internals).
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if ((err as any).validation) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
  });
}
