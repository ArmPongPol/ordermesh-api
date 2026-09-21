import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { UserProfileDto } from '../../users/dto/user-profile.dto';

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'The refresh token returned by login, register or a previous refresh.',
  })
  @IsString()
  refreshToken: string;
}

export class AuthTokensDto {
  @ApiProperty({
    description: 'Send as `Authorization: Bearer <accessToken>`.',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Single use. Every refresh returns a new one and retires this one; presenting a retired token revokes the whole session family.',
  })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({
    example: 900,
    description: 'Lifetime of the access token, in seconds.',
  })
  expiresIn: number;
}

/** What login and register return. */
export class AuthSessionDto {
  @ApiProperty({ type: UserProfileDto })
  user: UserProfileDto;

  @ApiProperty({ type: AuthTokensDto })
  tokens: AuthTokensDto;
}

export class RefreshedTokensDto {
  @ApiProperty({ type: AuthTokensDto })
  tokens: AuthTokensDto;
}

export class LogoutAllDto {
  @ApiProperty({ example: 3, description: 'How many sessions were ended.' })
  revoked: number;
}
