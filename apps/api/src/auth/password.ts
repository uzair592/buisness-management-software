import crypto from "node:crypto";

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 32,
};

function scryptPromise(
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptPromise(password, salt, SCRYPT_PARAMS.keyLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });

  return `$scrypt$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 5 || parts[1] !== "scrypt") {
      return false;
    }
    const paramPairs = parts[2].split(",");
    const params: Record<string, number> = {};
    for (const pair of paramPairs) {
      const [k, v] = pair.split("=");
      params[k] = parseInt(v, 10);
    }
    const salt = parts[3];
    const originalHash = Buffer.from(parts[4], "hex");

    const derivedKey = await scryptPromise(password, salt, originalHash.length, {
      N: params.N,
      r: params.r,
      p: params.p,
    });

    if (originalHash.length !== derivedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(originalHash, derivedKey);
  } catch {
    return false;
  }
}
