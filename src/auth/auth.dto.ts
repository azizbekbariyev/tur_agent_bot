import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/** Kirish: email yoki username. Eski frontend `email` yuboradi, yangisi - `login` */
export class LoginDto {
  @IsOptional()
  @IsString()
  login?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
