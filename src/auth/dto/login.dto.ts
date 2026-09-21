import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'somchai@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(320)
  email: string;

  /**
   * Note what is NOT here: no `@IsEmail` on the address, no `@MinLength` on the
   * password.
   *
   * Validating the credential's *shape* before checking it makes the failure
   * paths differ — a too-short password would 400 with a field error while a
   * wrong one 401s — which both leaks the password policy and gives an attacker
   * a cheap way to distinguish cases. Only the length cap survives, because
   * that is a denial-of-service guard rather than a policy statement.
   */
  @ApiProperty({ example: 'a long passphrase', maxLength: 128 })
  @IsString()
  @MaxLength(128)
  password: string;
}
