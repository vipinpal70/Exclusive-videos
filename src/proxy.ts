import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyToken } from "@/lib/session";

const PUBLIC_ADMIN_PAGES = ["/admin/login", "/admin/setup"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_ADMIN_PAGES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const admin = await verifyToken(req.cookies.get(ADMIN_COOKIE)?.value, "admin");
  if (!admin) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
