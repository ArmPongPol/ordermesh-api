import type { NextFunction, Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function run(headers: Record<string, string | string[]>) {
  const req = { headers } as unknown as Request;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;

  new RequestIdMiddleware().use(req, res, next);

  return { req, setHeader, next };
}

describe('RequestIdMiddleware', () => {
  it('generates a uuid when no request id is supplied', () => {
    const { req, setHeader, next } = run({});
    const id = req.headers['x-request-id'] as string;

    expect(id).toMatch(UUID_RE);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
    expect(next).toHaveBeenCalled();
  });

  it('reuses an inbound request id so traces stay correlated', () => {
    const { req, setHeader } = run({ 'x-request-id': 'upstream-id' });

    expect(req.headers['x-request-id']).toBe('upstream-id');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'upstream-id');
  });

  it('takes the first value when the header is repeated', () => {
    const { req } = run({ 'x-request-id': ['first', 'second'] });

    expect(req.headers['x-request-id']).toBe('first');
  });
});
