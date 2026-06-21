"use client";

import { useEffect } from "react";

const STORAGE_KEY = "ai_comic_auth";
const COOKIE_NAME = "ai_comic_auth";

/**
 * Syncs the ai_comic_uid cookie (set by middleware on first request)
 * into localStorage so that apiFetch can read it via getUserId().
 */
export function FingerprintProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Read the cookie that middleware guaranteed to set
    const cookieUid = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${COOKIE_NAME}=`))
      ?.split("=")[1];

    if (cookieUid) {
      // Sync cookie → localStorage so getUserId() / apiFetch works
      localStorage.setItem(STORAGE_KEY, cookieUid);
    }
  }, []);

  return <>{children}</>;
}
