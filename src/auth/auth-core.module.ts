import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthContextService } from './auth-context.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { RefreshToken } from './entities/refresh-token.entity';

/**
 * The identity primitives: password hashing, token signing, session storage and
 * the authorization snapshot.
 *
 * Split out from AuthModule because UsersService needs two of them —
 * `setStatus` must revoke sessions and invalidate the cache — while AuthService
 * needs UsersService. Keeping them all in one module would make
 * AuthModule <-> UsersModule circular and force `forwardRef` on both sides;
 * this layer has no dependency on either, so the graph stays acyclic.
 *
 * Nothing here knows what a user *is* beyond an id.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    // Registered bare: TokenService passes the secret and lifetimes explicitly
    // on every call, so there is no module-level configuration to drift.
    JwtModule.register({}),
  ],
  providers: [
    PasswordService,
    TokenService,
    RefreshTokenService,
    AuthContextService,
  ],
  exports: [
    PasswordService,
    TokenService,
    RefreshTokenService,
    AuthContextService,
  ],
})
export class AuthCoreModule {}
