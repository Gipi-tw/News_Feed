import "server-only";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { env } from "./env";

// Single-user private site. Session = signed JWT in an httpOnly cookie.
const COOKIE = "gipi_session";
const ALG = "HS256";
const secret = new TextEncoder().encode(env.authSecret);

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (!env.authUsername || !env.authPasswordHash) return false;
  if (username !== env.authUsername) return false;
  try {
    return await bcrypt.compare(password, env.authPasswordHash);
  } catch {
    return false;
  }
}

export async function createSession(username: string): Promise<void> {
  const token = await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Returns the username if a valid session cookie is present, else null. */
export async function getSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

/** Verify a raw token string (used by edge middleware). */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secret, { algorithms: [ALG] });
    return true;
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE;
