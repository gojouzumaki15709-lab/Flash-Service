import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

function secretKey() {
  return new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret");
}

const ROLE_FOR_PATH: Record<string, string> = {
  "/admin": "admin",
  "/vendeur": "vendor",
  "/client": "client",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const matchedPrefix = Object.keys(ROLE_FOR_PATH).find((p) => pathname.startsWith(p));
  if (!matchedPrefix) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.redirect(new URL("/", req.url));

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.role !== ROLE_FOR_PATH[matchedPrefix]) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/", req.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/vendeur/:path*", "/client/:path*"],
};
