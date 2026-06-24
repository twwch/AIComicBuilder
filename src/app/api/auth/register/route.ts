import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { id as genId } from "@/lib/id";
import { hashPassword } from "@/lib/auth/password";
import { setLoginCookie } from "@/lib/auth/session";
import {
  clearRateLimit,
  consumeRateLimit,
  getClientIp,
  tooManyRequests,
} from "@/lib/auth/rate-limit";

const REGISTER_IP_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxAttempts: 5,
};

const REGISTER_EMAIL_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxAttempts: 3,
};

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const ipLimit = consumeRateLimit(`register:ip:${ip}`, REGISTER_IP_LIMIT);
  if (!ipLimit.ok) {
    return tooManyRequests("注册过于频繁，请稍后再试", ipLimit.retryAfterSeconds);
  }

  const emailLimit = consumeRateLimit(`register:email:${email}`, REGISTER_EMAIL_LIMIT);
  if (!emailLimit.ok) {
    return tooManyRequests("该邮箱尝试注册次数过多，请稍后再试", emailLimit.retryAfterSeconds);
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return NextResponse.json({ error: "该邮箱已被注册" }, { status: 409 });
  }

  const userId = genId();
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
  });

  clearRateLimit(`register:email:${email}`);
  await setLoginCookie(userId);

  return NextResponse.json({
    user: { id: userId, email },
  });
}
