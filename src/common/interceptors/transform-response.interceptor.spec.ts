import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { TransformResponseInterceptor } from './transform-response.interceptor';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

function makeContext(statusCode = 200, type: 'http' | 'rpc' = 'http') {
  return {
    getType: () => type,
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

function makeHandler<T>(payload: T): CallHandler<T> {
  return { handle: () => of(payload) };
}

describe('TransformResponseInterceptor', () => {
  let reflector: Reflector;
  let interceptor: TransformResponseInterceptor<unknown>;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TransformResponseInterceptor(reflector);
  });

  async function run<T>(payload: T, statusCode = 200) {
    const result = interceptor.intercept(
      makeContext(statusCode),
      makeHandler(payload),
    );
    return firstValueFrom(await result);
  }

  it('wraps a plain payload in the envelope', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({
      success: true,
      status: 200,
      message: 'Success',
      data: { id: 1 },
    });
  });

  it('uses the handler message when the payload is a { message, data } shape', async () => {
    await expect(
      run({ message: 'Order created', data: { id: 7 } }, 201),
    ).resolves.toEqual({
      success: true,
      status: 201,
      message: 'Order created',
      data: { id: 7 },
    });
  });

  it('wraps arrays as data without treating them as a message shape', async () => {
    await expect(run([1, 2, 3])).resolves.toEqual({
      success: true,
      status: 200,
      message: 'Success',
      data: [1, 2, 3],
    });
  });

  // Regression: `|| null` used to turn every falsy payload into null.
  it.each([
    [0, 0],
    ['', ''],
    [false, false],
    [null, null],
    [undefined, null],
  ])('preserves falsy payload %p as %p', async (payload, expected) => {
    await expect(run(payload)).resolves.toEqual({
      success: true,
      status: 200,
      message: 'Success',
      data: expected,
    });
  });

  it('preserves a falsy value inside the { message, data } shape', async () => {
    await expect(run({ message: 'Counted', data: 0 })).resolves.toEqual({
      success: true,
      status: 200,
      message: 'Counted',
      data: 0,
    });
  });

  // Regression: the interceptor read the literal string 'SKIP_TRANSFORM_KEY'
  // instead of the exported constant, so @SkipTransform() never applied.
  it('leaves the payload untouched when @SkipTransform() is set', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === SKIP_TRANSFORM_KEY ? true : undefined,
      );

    await expect(run({ status: 'ok' })).resolves.toEqual({ status: 'ok' });
  });

  it('leaves non-http contexts untouched', async () => {
    const result = interceptor.intercept(
      makeContext(200, 'rpc'),
      makeHandler({ raw: true }),
    );
    await expect(firstValueFrom(await result)).resolves.toEqual({ raw: true });
  });
});
