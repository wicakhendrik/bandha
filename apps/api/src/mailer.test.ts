import { describe, expect, it } from "vitest";
import { appUrl, loadConfig } from "./config";
import { resetPasswordEmail } from "./mailer";

const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "j".repeat(40) };

describe("mail configuration", () => {
  it("defaults to the console transport in development", () => {
    expect(loadConfig(base).MAIL_TRANSPORT).toBe("console");
  });
  it("refuses the console transport in production, because reset links would be printed to the logs", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/MAIL_TRANSPORT/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", MAIL_TRANSPORT: "smtp", SMTP_URL: "smtps://u:p@smtp.example.com:465" })).not.toThrow();
  });
  it("smtp needs a url", () => {
    expect(() => loadConfig({ ...base, MAIL_TRANSPORT: "smtp" })).toThrow(/SMTP_URL/);
  });
  it("links point at APP_URL, else the first web origin, without a trailing slash", () => {
    expect(appUrl(loadConfig({ ...base, WEB_ORIGIN: "http://localhost:3000, http://localhost:8081" }))).toBe("http://localhost:3000");
    expect(appUrl(loadConfig({ ...base, APP_URL: "https://bandha.grezly.app/" }))).toBe("https://bandha.grezly.app");
  });
});

describe("reset email", () => {
  it("has both languages, the link in text and html, and the expiry", () => {
    const m = resetPasswordEmail("a@b.co", "https://bandha.grezly.app/reset-password?token=abc_DEF-123", 30);
    expect(m.to).toBe("a@b.co");
    expect(m.text).toContain("Jika bukan Anda");
    expect(m.text).toContain("If you did not ask");
    expect(m.text).toContain("https://bandha.grezly.app/reset-password?token=abc_DEF-123");
    expect(m.text).toContain("30 menit");
    expect(m.html).toContain('href="https://bandha.grezly.app/reset-password?token=abc_DEF-123"');
  });
  it("escapes the link inside html", () => {
    const m = resetPasswordEmail("a@b.co", 'https://x.test/?a=1&b="2"<script>', 30);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&amp;b=&quot;2&quot;&lt;script&gt;");
  });
});
