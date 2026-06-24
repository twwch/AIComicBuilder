import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE_NAME } from "@/lib/auth/shared";

const intlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth/")) {
      return NextResponse.next();
    }

    const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!hasSessionCookie) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    return NextResponse.next();
  }

  const response = intlMiddleware(request);
  const localeMatch = pathname.match(/^\/(zh|en|ja|ko)(\/.*)?$/);
  if (!localeMatch) return response;

  const locale = localeMatch[1];
  const suffix = localeMatch[2] ?? "";
  const isLoginPage = suffix === "/login";
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSessionCookie && !isLoginPage) {
    return Response.redirect(new URL(`/${locale}/login`, request.url));
  }

  if (hasSessionCookie && isLoginPage) {
    return Response.redirect(new URL(`/${locale}`, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/api/uploads/:path*", "/((?!_next|_vercel|.*\\..*).*)"],
};
