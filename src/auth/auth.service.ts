import { Injectable } from '@nestjs/common';
import {
  accountNotActive,
  emailAlreadyExists,
  invalidCredentials,
  invalidToken,
} from '../common/exceptions/app.exception';
import { toUserProfileDto } from '../users/dto/user-profile.dto';
import { UsersService } from '../users/users.service';
import { AuthContextService } from './auth-context.service';
import { PasswordService } from './password.service';
import {
  RefreshTokenService,
  RequestFingerprint,
} from './refresh-token.service';
import { TokenService } from './token.service';
import { AuthSessionDto, AuthTokensDto } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly authContext: AuthContextService,
  ) {}

  async register(
    dto: RegisterDto,
    fingerprint: RequestFingerprint,
  ): Promise<AuthSessionDto> {
    // A pre-check would still race, so `createWithRole` translates the unique
    // violation as well. This one exists only to avoid burning an argon2 hash
    // on the common, non-racing case.
    const existing = await this.users.findByEmailWithPassword(dto.email);
    if (existing) {
      // Deliberately an existence oracle. Hiding it requires email
      // verification ("check your inbox"), which is out of scope — so it is an
      // accepted trade-off, documented in the README, and the endpoint carries
      // the same throttle as login to keep enumeration slow.
      throw emailAlreadyExists();
    }

    const user = await this.users.createWithRole({
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      fullName: dto.fullName,
    });

    return this.startSession(user.id, fingerprint);
  }

  async login(
    dto: LoginDto,
    fingerprint: RequestFingerprint,
  ): Promise<AuthSessionDto> {
    const user = await this.users.findByEmailWithPassword(dto.email);

    if (!user) {
      // Spend the same CPU the real path would. Without this, "no such email"
      // returns measurably faster than "wrong password" and login becomes a
      // timing oracle for which addresses are registered.
      await this.passwords.verifyDummy(dto.password);
      throw invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw invalidCredentials();
    }

    // Checked only after the password, so a valid-credentials-but-suspended
    // response cannot be provoked without the password.
    if (user.status !== 'ACTIVE') {
      await this.refreshTokens.revokeAllForUser(user.id, 'USER_DISABLED');
      throw accountNotActive(user.status);
    }

    // Opportunistic upgrade: raising PASSWORD_HASH_OPTIONS later re-hashes the
    // fleet as people sign in, with no migration and no password resets.
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(
        user.id,
        await this.passwords.hash(dto.password),
      );
    }

    return this.startSession(user.id, fingerprint);
  }

  async refresh(
    presented: string,
    fingerprint: RequestFingerprint,
  ): Promise<AuthTokensDto> {
    const { issued, userId } = await this.refreshTokens.rotate(
      presented,
      fingerprint,
    );

    // Re-check status on every refresh: a user suspended mid-session must not
    // be able to mint a new access token, and killing the family here means
    // they cannot outlive their current access token either.
    const snapshot = await this.authContext.get(userId);
    if (!snapshot) {
      throw invalidToken('Token subject no longer exists');
    }
    if (snapshot.status !== 'ACTIVE') {
      await this.refreshTokens.revokeAllForUser(userId, 'USER_DISABLED');
      throw accountNotActive(snapshot.status);
    }

    return {
      accessToken: this.tokens.signAccessToken(userId, issued.familyId),
      refreshToken: issued.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  async logout(userId: string, presented: string): Promise<void> {
    await this.refreshTokens.revoke(presented, 'LOGOUT');
    this.authContext.invalidate(userId);
  }

  async logoutAll(userId: string): Promise<number> {
    const revoked = await this.refreshTokens.revokeAllForUser(
      userId,
      'LOGOUT_ALL',
    );
    this.authContext.invalidate(userId);
    return revoked;
  }

  /** Issues a fresh family plus its first access token. */
  private async startSession(
    userId: string,
    fingerprint: RequestFingerprint,
  ): Promise<AuthSessionDto> {
    const issued = await this.refreshTokens.issue(userId, fingerprint);

    // Registration has just written user_roles, so any cached snapshot from a
    // pre-registration probe would be stale.
    this.authContext.invalidate(userId);
    const snapshot = await this.authContext.get(userId);

    if (!snapshot) {
      throw invalidCredentials();
    }

    return {
      user: toUserProfileDto(snapshot),
      tokens: {
        // The access token's jti is the family id, so `logout` can name the
        // session it is ending.
        accessToken: this.tokens.signAccessToken(userId, issued.familyId),
        refreshToken: issued.token,
        tokenType: 'Bearer',
        expiresIn: this.tokens.accessTtlSeconds,
      },
    };
  }
}
