import crypto from "node:crypto";

let _keyHash: Buffer | null = null;

export function getKeyHash(): Buffer {
  if (!_keyHash) {
    const key = process.env.GOITALIA_SECRET_KEY || process.env.BETTER_AUTH_SECRET || "goitalia-default-key-change-me";
    _keyHash = crypto.createHash("sha256").update(key).digest();
  }
  return _keyHash;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", getKeyHash(), iv);
  let e = c.update(text, "utf8", "hex");
  e += c.final("hex");
  return iv.toString("hex") + ":" + e;
}

export function decrypt(text: string): string {
  const [ivHex, enc] = text.split(":");
  if (!ivHex || !enc) throw new Error("Invalid encrypted value");
  const d = crypto.createDecipheriv("aes-256-cbc", getKeyHash(), Buffer.from(ivHex, "hex"));
  let r = d.update(enc, "hex", "utf8");
  r += d.final("utf8");
  return r;
}
