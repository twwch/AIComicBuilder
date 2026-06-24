import crypto from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME } from "./shared";

function authSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-change-me";
  }

  throw new Error("AUTH_SECRET is required in production");
}

export function signUserToken(userId: string) {
  const signature = crypto
    .createHmac("sha256", authSecret())
    .update(userId)
    .digest("hex");

  return `${userId}.${signature}`;
}

export function verifyUserToken(token: string | null | undefined) {
  if (!token) return null;
  const [userId, signature] = token.split(".");
  if (!userId || !signature) return null;

  const expected = crypto
    .createHmac("sha256", authSecret())
    .update(userId)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  return userId;
}

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = verifyUserToken(token);
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function setLoginCookie(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, signUserToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearLoginCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
