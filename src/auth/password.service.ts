import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PASSWORD_HASH_OPTIONS } from './auth.constants';

@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * A throwaway hash verified against when no user matched, so that the "user
   * not found" path costs the same as the "wrong password" path.
   *
   * Computed at boot from a random string with the real parameters, so its cost
   * tracks PASSWORD_HASH_OPTIONS automatically — a hardcoded literal would go
   * stale the moment the parameters were raised, reopening the timing channel
   * precisely when someone thought they were improving security.
   */
  private dummyHash?: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64'));
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, PASSWORD_HASH_OPTIONS);
  }

  /**
   * Returns false rather than throwing on a malformed or unrecognised hash:
   * a corrupt row must read as "wrong password", not as a 500 that tells the
   * caller their email was at least real.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Burn the same CPU the real path would, then discard the result. Call this
   * on every login where no user was found.
   */
  async verifyDummy(plain: string): Promise<void> {
    const hash = this.dummyHash ?? (await this.hash('unused'));
    await this.verify(hash, plain);
  }

  /**
   * True when `hash` was produced with weaker parameters than the current
   * PASSWORD_HASH_OPTIONS. Rehashing on successful login upgrades the fleet
   * organically, without a migration and without anyone resetting a password.
   */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, PASSWORD_HASH_OPTIONS);
    } catch {
      // Unparseable: treat as needing a rehash rather than silently keeping it.
      return true;
    }
  }
}
