import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_PASSWORD_BYTES } from '../password.js';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  // bcrypt memakai 72 byte pertama; yang lebih panjang ditolak, bukan dipotong.
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PASSWORD_BYTES)
  password: string;
}
