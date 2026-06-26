// Symmetric encryption for secrets stored at rest (e.g. API tokens). Uses
// AES-256-GCM with a key derived from AUTH_SECRET. Node-only.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const secret =
    process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "rd-aisec-dev-secret";
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

/** Encrypt a string → "v1:<iv>:<tag>:<ciphertext>" (all base64). */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value produced by encryptSecret. Returns "" on any failure. */
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  try {
    const [v, ivB64, tagB64, dataB64] = stored.split(":");
    if (v !== "v1") return "";
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}
