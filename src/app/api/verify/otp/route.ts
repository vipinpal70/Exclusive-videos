import { NextResponse } from "next/server";
import { fail, getUser, publicRoute } from "@/lib/auth";
import { execute } from "@/lib/db";
import { getMember, publicMember } from "@/lib/members";
import { checkOtp } from "@/lib/otp";
import { cookieOptions, signToken, USER_COOKIE } from "@/lib/session";

const USER_TTL = 60 * 60 * 24;

export const POST = publicRoute(async (req) => {
  const user = await getUser();
  if (!user) return fail("Session expired. Please enter your email again.", 401);
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) return fail("Enter the 6-digit code.");

  const check = await checkOtp(user.email, code);
  if (!check.ok) return fail(check.error);

  await execute("UPDATE members SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?", [user.mid]);
  const member = await getMember(user.mid);
  if (!member) return fail("Account not found.", 404);

  const res = NextResponse.json({ ok: true, member: publicMember(member, true) });
  res.cookies.set(USER_COOKIE, await signToken({ mid: user.mid, email: user.email, ev: true }, USER_TTL, "user"), cookieOptions(USER_TTL));
  return res;
});
