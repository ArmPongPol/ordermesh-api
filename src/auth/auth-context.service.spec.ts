import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthContextService } from './auth-context.service';

const ROW = {
  id: 'user-1',
  email: 'Somchai@Example.com',
  full_name: 'Somchai Jaidee',
  status: 'ACTIVE' as const,
  roles: ['CUSTOMER'],
  permissions: ['order:read', 'order:create'],
};

function makeService(ttlMs: number, rows: unknown[] = [ROW]) {
  const query = jest.fn().mockResolvedValue(rows);
  const dataSource = { query } as unknown as DataSource;
  const config = {
    get: jest.fn().mockReturnValue(ttlMs),
  } as unknown as ConfigService;

  return { service: new AuthContextService(dataSource, config), query };
}

describe('AuthContextService', () => {
  it('maps the snake_case row onto the snapshot', async () => {
    const { service } = makeService(0);

    await expect(service.get('user-1')).resolves.toEqual({
      id: 'user-1',
      email: 'Somchai@Example.com',
      fullName: 'Somchai Jaidee',
      status: 'ACTIVE',
      roles: ['CUSTOMER'],
      permissions: ['order:read', 'order:create'],
    });
  });

  it('resolves roles and permissions in a single query', async () => {
    const { service, query } = makeService(0);

    await service.get('user-1');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['user-1']);
  });

  it('returns null for an unknown user', async () => {
    const { service } = makeService(0, []);

    await expect(service.get('nobody')).resolves.toBeNull();
  });

  it('serves a second call from cache while the TTL holds', async () => {
    const { service, query } = makeService(30_000);

    await service.get('user-1');
    await service.get('user-1');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed', async () => {
    jest.useFakeTimers();
    try {
      const { service, query } = makeService(30_000);

      await service.get('user-1');
      jest.advanceTimersByTime(30_001);
      await service.get('user-1');

      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // This is what makes a single-instance deployment exactly consistent rather
  // than eventually consistent: every mutation that changes the answer calls it.
  it('reloads immediately after invalidate()', async () => {
    const { service, query } = makeService(30_000);

    await service.get('user-1');
    service.invalidate('user-1');
    await service.get('user-1');

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll() drops every cached user', async () => {
    const { service, query } = makeService(30_000);

    await service.get('user-1');
    await service.get('user-2');
    service.invalidateAll();
    await service.get('user-1');
    await service.get('user-2');

    expect(query).toHaveBeenCalledTimes(4);
  });

  // The test/dev default. Caching a stale snapshot during a test run would make
  // role changes appear not to take effect.
  it('does not cache at all when the TTL is 0', async () => {
    const { service, query } = makeService(0);

    await service.get('user-1');
    await service.get('user-1');
    await service.get('user-1');

    expect(query).toHaveBeenCalledTimes(3);
  });

  it('never caches a miss, so a newly created user is visible at once', async () => {
    const { service, query } = makeService(30_000, []);

    await service.get('user-1');
    await service.get('user-1');

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps users separate in the cache', async () => {
    const { service, query } = makeService(30_000);

    await service.get('user-1');
    await service.get('user-2');

    expect(query).toHaveBeenCalledTimes(2);
  });
});
