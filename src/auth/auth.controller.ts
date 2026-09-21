import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ApiEnvelopeErrorResponse,
  ApiEnvelopeResponse,
} from '../common/decorators/api-response.decorator';
import {
  UserProfileDto,
  toUserProfileDto,
} from '../users/dto/user-profile.dto';
import { AuthService } from './auth.service';
import { LOGIN_THROTTLE } from './auth.constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  AuthSessionDto,
  LogoutAllDto,
  RefreshTokenDto,
  RefreshedTokensDto,
} from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthenticatedUser } from './types/authenticated-user';
import type { RequestFingerprint } from './refresh-token.service';

function fingerprintOf(request: Request): RequestFingerprint {
  return {
    userAgent: request.headers['user-agent'] ?? null,
    ip: request.ip ?? null,
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  // Same throttle as login: register is an email-existence oracle by design
  // (409 on a taken address), so enumeration must stay expensive.
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiEnvelopeResponse(AuthSessionDto, { status: 201 })
  @ApiEnvelopeErrorResponse(409, 'An account with this email already exists')
  @ApiEnvelopeErrorResponse(429, 'Too many attempts')
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.auth.register(dto, fingerprintOf(request));
  }

  @Post('login')
  // 200, not the 201 a POST defaults to: logging in creates a session, but the
  // response is not a resource at a new URL.
  @HttpCode(200)
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiEnvelopeErrorResponse(401, 'Invalid email or password')
  @ApiEnvelopeErrorResponse(403, 'Account is suspended or inactive')
  @ApiEnvelopeErrorResponse(429, 'Too many attempts')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, fingerprintOf(request));
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Returns a new pair and retires the presented token. Presenting an already-rotated token is treated as theft: the entire session family is revoked and the call fails with TOKEN_REUSE_DETECTED.',
  })
  @ApiEnvelopeResponse(RefreshedTokensDto)
  @ApiEnvelopeErrorResponse(401, 'Invalid, expired or replayed refresh token')
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    return {
      tokens: await this.auth.refresh(dto.refreshToken, fingerprintOf(request)),
    };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End this session' })
  // 200 with an empty payload rather than 204: Express drops the body on a 204,
  // which would break the response envelope every other route returns.
  @ApiEnvelopeErrorResponse(401, 'Not authenticated')
  async logout(
    @CurrentUser('id') userId: string,
    @Body() dto: RefreshTokenDto,
  ) {
    await this.auth.logout(userId, dto.refreshToken);
    return { message: 'Logged out', data: null };
  }

  @Post('logout-all')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End every session for this account' })
  @ApiEnvelopeResponse(LogoutAllDto)
  @ApiEnvelopeErrorResponse(401, 'Not authenticated')
  async logoutAll(@CurrentUser('id') userId: string) {
    return {
      message: 'All sessions revoked',
      data: { revoked: await this.auth.logoutAll(userId) },
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The current user, with their roles and permissions',
  })
  @ApiEnvelopeResponse(UserProfileDto)
  @ApiEnvelopeErrorResponse(401, 'Not authenticated')
  me(@CurrentUser() user: AuthenticatedUser): UserProfileDto {
    return toUserProfileDto(user);
  }
}
