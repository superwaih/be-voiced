import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import { sessions, subscriptions, users } from "./db/schema";

/**
 * Who is making this request.
 *
 * Sessions are **opaque rows**, not JWTs. A row can be deleted, which means signing out actually
 * signs someone out and a stolen cookie can be revoked; a JWT is valid until it expires whatever
 * you do. The cookie holds nothing but the row's id.
 *
 * Passwords are hashed with scrypt from Node's own crypto — memory-hard, no native module to
 * build, nothing to keep up to date. The salt is stored beside the hash and both are compared in
 * constant time.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const COOKIE = "bv_session";
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  // Both buffers are the same length by construction, so this cannot leak length either.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Minimum that is worth enforcing. Length beats character classes; the research is clear. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That is longer than it needs to be.";
  return null;
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

// --- Sessions -----------------------------------------------------------------------------------

export async function startSession(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const [session] = await db.insert(sessions).values({ userId, expiresAt }).returning({ id: sessions.id });

  const jar = await cookies();
  jar.set(COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await db.delete(sessions).where(eq(sessions.id, id)).catch(() => undefined);
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Expired rows are treated as absent and tidied up lazily. */
export async function currentUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;

  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));

  return row ?? null;
}

/**
 * The signed-in user, or an error.
 *
 * Every route that touches someone's data uses this, so "is this person allowed" is answered in
 * one place rather than remembered in twenty.
 */
export async function requireUser(): Promise<{ id: string; email: string; name: string | null }> {
  const user = await currentUser();
  if (!user) throw new Unauthorised();
  return user;
}

export class Unauthorised extends Error {
  constructor() {
    super("Sign in first.");
    this.name = "Unauthorised";
  }
}

/** Kept for the routes that only need the id. */
export async function currentUserId(): Promise<string> {
  return (await requireUser()).id;
}

// --- Registration -------------------------------------------------------------------------------

export async function register(email: string, password: string, name?: string) {
  const address = normaliseEmail(email);

  // The account and its free plan are created together: a user without a subscription row is a
  // state every quota check would then have to allow for.
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, address));
    if (existing) throw new Error("There is already an account with that address.");

    const [user] = await tx
      .insert(users)
      .values({ email: address, name: name?.trim() || null, passwordHash: await hashPassword(password) })
      .returning({ id: users.id, email: users.email, name: users.name });

    await tx.insert(subscriptions).values({ userId: user.id, plan: "free", status: "active" });
    return user;
  });
}

export async function signIn(email: string, password: string) {
  const address = normaliseEmail(email);
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, address));

  // The same answer whether the address is unknown or the password is wrong, so this cannot be
  // used to find out who has an account. The hash of a dummy keeps the timing similar too.
  const hash = user?.passwordHash ?? `scrypt:${randomUUID()}:${randomUUID()}`;
  const ok = await verifyPassword(password, hash);
  if (!user || !ok) throw new Error("That email and password do not match.");

  return { id: user.id, email: user.email, name: user.name };
}
