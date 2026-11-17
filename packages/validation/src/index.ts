import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, "Minimal 10 karakter").max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/, "Kode terdiri dari 6 angka") });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const updateProfileSchema = z.object({ name: z.string().trim().min(1, "Isi nama").max(80) });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Isi kata sandi saat ini").max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}
export * from "./finance";
