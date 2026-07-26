import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth gate temporarily disabled so the app is publicly reachable.
 * Re-enable password protection by restoring session checks against
 * APP_PASSWORD / SESSION_SECRET (see git history for the previous proxy).
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image).*)",
  ],
};
