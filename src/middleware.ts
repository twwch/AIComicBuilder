import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { createSignedUserId, verifyToken } from "@/lib/auth-edge";

const COOKIE_NAME = "ai_comic_auth";

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  const existing = request.cookies.get(COOKIE_NAME);
  const existingUid = existing ? await verifyToken(existing.value) : null;

  if (existingUid) {
    response.cookies.set("ai_comic_uid", existingUid, {
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });
  } else {
    const token = await createSignedUserId();
    const uid = token.split(".")[0];
    response.cookies.set(COOKIE_NAME, token, {
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });
    response.cookies.set("ai_comic_uid", uid, {
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
