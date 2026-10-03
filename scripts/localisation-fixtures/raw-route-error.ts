declare const reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
  send(payload: unknown): unknown;
};

export function chainedRoute() {
  return reply.code(400).send({ error: 'Untranslated fixture route error' });
}

export function directRoute() {
  reply.send({ detail: 'Untranslated fixture route detail' });
}

export function returnedRoute() {
  return { message: 'Untranslated fixture route message' };
}
