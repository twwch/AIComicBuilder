import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { setLoginCookie } from "@/lib/auth/session";
import {
  clearRateLimit,
  consumeRateLimit,
  getClientIp,
  tooManyRequests,
} from "@/lib/auth/rate-limit";

const LOGIN_IP_LIMIT = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 10,
};

const LOGIN_EMAIL_LIMIT = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 5,
};

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码不能为空" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const ipLimit = consumeRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT);
  if (!ipLimit.ok) {
    return tooManyRequests("尝试过于频繁，请稍后再试", ipLimit.retryAfterSeconds);
  }

  const emailLimit = consumeRateLimit(`login:email:${email}`, LOGIN_EMAIL_LIMIT);
  if (!emailLimit.ok) {
    return tooManyRequests("该账号尝试次数过多，请稍后再试", emailLimit.retryAfterSeconds);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  clearRateLimit(`login:email:${email}`);
  await setLoginCookie(user.id);

  return NextResponse.json({
    user: { id: user.id, email: user.email },
  });
}
