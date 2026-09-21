import * as argon2 from 'argon2';
import { PasswordService } from './password.service';
import { PASSWORD_HASH_OPTIONS } from './auth.constants';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeAll(async () => {
    service = new PasswordService();
    await service.onModuleInit();
  });

  it('hashes with argon2id and never returns the plaintext', async () => {
    const hash = await service.hash('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse');
  });

  it('salts every hash, so the same password hashes differently', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(a).not.toBe(b);
    await expect(service.verify(a, 'same-password')).resolves.toBe(true);
    await expect(service.verify(b, 'same-password')).resolves.toBe(true);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await service.hash('s3cret-password');

    await expect(service.verify(hash, 's3cret-password')).resolves.toBe(true);
    await expect(service.verify(hash, 's3cret-passwore')).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  // A corrupt row must read as "wrong password", not as a 500 — a 500 would
  // itself confirm that the email matched a real account.
  it('returns false rather than throwing on a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(service.verify('', 'anything')).resolves.toBe(false);
  });

  it('does not ask for a rehash at the current parameters', async () => {
    expect(service.needsRehash(await service.hash('x'))).toBe(false);
  });

  it('asks for a rehash when the stored hash is weaker than current policy', async () => {
    const weak = await argon2.hash('x', {
      ...PASSWORD_HASH_OPTIONS,
      memoryCost: PASSWORD_HASH_OPTIONS.memoryCost / 2,
    });

    expect(service.needsRehash(weak)).toBe(true);
  });

  it('treats an unparseable hash as needing a rehash', () => {
    expect(service.needsRehash('garbage')).toBe(true);
  });

  // The timing defence for the unknown-email path. It must complete quietly:
  // if it threw, the "no such user" branch would differ observably from the
  // "wrong password" branch.
  it('verifies a dummy hash without throwing', async () => {
    await expect(service.verifyDummy('whatever')).resolves.toBeUndefined();
  });

  it('spends comparable time on the dummy path as on a real verify', async () => {
    const hash = await service.hash('real-password');

    const time = async (fn: () => Promise<unknown>) => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real = await time(() => service.verify(hash, 'wrong-password'));
    const dummy = await time(() => service.verifyDummy('wrong-password'));

    // Deliberately loose — this asserts the dummy path does the real argon2
    // work, not that the two are indistinguishable to a stopwatch.
    expect(dummy).toBeGreaterThan(real / 4);
  });
});
