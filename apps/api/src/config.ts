import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /** "fake" gives deterministic prices for local development and tests only. */
  MARKET_PROVIDER: z.enum(["coingecko", "fake"]).default("coingecko"),
  MARKET_SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).default(15),
  COINGECKO_API_KEY: z.string().optional(),
  /** Public address of the web app, used in emailed links. Defaults to the first WEB_ORIGIN. */
  APP_URL: z.string().url().optional(),
  /** "console" prints emails (development only); "smtp" sends them through SMTP_URL. */
  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  /** e.g. smtps://user:password@smtp.example.com:465 */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Bandha <no-reply@bandha.grezly.app>"),
  /** Registration needs a 6-digit code sent by email. Turn it off ("false") only as an emergency switch when email cannot be sent. */
  REQUIRE_EMAIL_OTP: z.string().default("true").transform((v) => !["false", "0", "off", "no"].includes(v.trim().toLowerCase())),
  NODE_ENV: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.MAIL_TRANSPORT === "smtp" && !v.SMTP_URL) ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "SMTP_URL is required when MAIL_TRANSPORT=smtp" });
  if (v.NODE_ENV === "production" && v.MAIL_TRANSPORT === "console") {
    ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "set MAIL_TRANSPORT=smtp in production (the console transport would print reset links to the logs)" });
  }
});

export type Config = z.infer<typeof schema>;

/** Where emailed links point: APP_URL, else the first allowed web origin. */
export const appUrl = (c: Config) => (c.APP_URL ?? c.WEB_ORIGIN.split(",")[0]!.trim()).replace(/\/+$/, "");

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
