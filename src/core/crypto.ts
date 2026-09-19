import crypto from "crypto";
import { config } from "../config/env";

export interface EncryptedPayload {
  iv: string;         // Base64 12-byte initialization vector
  ciphertext: string; // Base64 ciphertext
  tag: string;        // Base64 16-byte authentication tag
  algorithm: string;
}

export class ZeroKnowledgeCrypto {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly IV_LENGTH = 12; // Recommended for AES-GCM
  private static readonly TAG_LENGTH = 16;
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEY_LENGTH = 32; // 256 bits

  /**
   * Derives a deterministic 256-bit encryption key for a specific tenant.
   */
  public static deriveTenantKey(tenantId: string, userPassphrase?: string): Buffer {
    const salt = crypto.createHash("sha256").update(`tenant_salt_${tenantId}`).digest();
    const secret = userPassphrase || config.ENCRYPTION_MASTER_KEY;
    return crypto.pbkdf2Sync(secret, salt, this.PBKDF2_ITERATIONS, this.KEY_LENGTH, "sha256");
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   */
  public static encrypt(plaintext: string, key: Buffer): EncryptedPayload {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
      algorithm: this.ALGORITHM
    };
  }

  /**
   * Decrypts an AES-256-GCM encrypted payload.
   * Throws if key is incorrect or ciphertext has been tampered with.
   */
  public static decrypt(payload: EncryptedPayload, key: Buffer): string {
    const iv = Buffer.from(payload.iv, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    const tag = Buffer.from(payload.tag, "base64");

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  }

  /**
   * Generates a blind index (HMAC-SHA-256) for exact-match searches on encrypted fields.
   */
  public static generateBlindIndex(term: string, tenantId: string): string {
    const normalized = term.trim().toLowerCase();
    const hmacKey = this.deriveTenantKey(tenantId);
    return crypto.createHmac("sha256", hmacKey).update(normalized).digest("hex");
  }
}
