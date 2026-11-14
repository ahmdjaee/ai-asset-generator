/**
 * Sanitasi stream SDK sebelum disimpan sebagai fixture atau transcript eval (AGENTS.md §6):
 * email, id akun/organisasi, path home, dan data gambar base64 diganti penanda.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SENSITIVE_KEY = /(email|account|organization|org_id|org_uuid|user_id)/i;
/** Panjang minimal string yang dianggap data base64 gambar. */
const BASE64_MIN = 256;
const BASE64 = /^[A-Za-z0-9+/=\r\n]+$/;

export type SanitizeContext = Readonly<{ homeDir: string; extraSecrets?: readonly string[] }>;

export const REDACTED = "<disamarkan>";
export const IMAGE_PLACEHOLDER = "<gambar base64 dihapus>";

function sanitizeString(value: string, context: SanitizeContext): string {
  if (value.length >= BASE64_MIN && BASE64.test(value)) return IMAGE_PLACEHOLDER;
  let result = value.replace(EMAIL, "pemilik@contoh.invalid");
  if (context.homeDir.length > 1) result = result.split(context.homeDir).join("/home/pemilik");
  for (const secret of context.extraSecrets ?? []) {
    if (secret.length >= 4) result = result.split(secret).join(REDACTED);
  }
  return result;
}

export function sanitize(value: unknown, context: SanitizeContext): unknown {
  if (typeof value === "string") return sanitizeString(value, context);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, context));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) && (typeof item === "string" || typeof item === "number")
          ? REDACTED
          : sanitize(item, context),
      ]),
    );
  }
  return value;
}
