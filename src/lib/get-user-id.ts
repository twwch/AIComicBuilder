import { SESSION_COOKIE_NAME } from "@/lib/auth/shared";
import { verifyUserToken } from "@/lib/auth/session";

function readCookie(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return rest.join("=");
    }
  }
  return "";
}

export function getUserIdFromRequest(request: Request): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  return verifyUserToken(token) ?? "";
}
