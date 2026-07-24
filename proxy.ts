import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, decryptSession } from "@/lib/session-token";

const PUBLIC_PATHS = new Set(["/login"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow Next internals and static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname === "/manifest.json"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = (await decryptSession(token)) !== null;

  const isPublic = PUBLIC_PATHS.has(pathname);
  // Setup API is authenticated by SETUP_SECRET (fail-closed in the route itself)
  const isSetupApi = pathname === "/api/setup-month";
  const isApi = pathname.startsWith("/api/");

  if (!authenticated && !isPublic && !isSetupApi) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (authenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image).*)",
  ],
};
