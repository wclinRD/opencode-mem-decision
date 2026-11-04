import { scrypt, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export async function deriveKey(password, salt) {
  return scryptAsync(password, salt, KEY_LENGTH);
}

export function encryptData(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

export function decryptData(header, key) {
  const iv = Buffer.from(header.iv, "base64");
  const tag = Buffer.from(header.tag, "base64");
  const ciphertext = Buffer.from(header.data, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
