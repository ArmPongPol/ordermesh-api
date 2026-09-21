import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'Somchai@example.com', maxLength: 320 })
  // Trim only — deliberately NOT lowercased. The address is stored as the user
  // typed it (docs/schema.dbml [FIX 3]); uniqueness and lookup both match on
  // lower(email) via the uq_users_email_lower index.
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    example: 'a long passphrase',
    minLength: 8,
    maxLength: 128,
    description:
      'A length floor and no composition rules, per NIST 800-63B. The upper bound is a denial-of-service guard, not a policy.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Somchai Jaidee', maxLength: 160 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName: string;
}
