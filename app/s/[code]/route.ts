import { NextResponse } from "next/server";
import { getAppSql } from "@/src/auth/app-sql";
import { resolveShortLink } from "@/src/studio/bio";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ code: string }> };

function isPrefetch(request: Request): boolean {
  if (request.headers.get("next-router-prefetch") === "1") return true;
  const purpose = request.headers.get("purpose");
  if (purpose?.trim().toLowerCase() === "prefetch") return true;
  const secPurpose = request.headers.get("sec-purpose");
  return secPurpose?.toLowerCase().includes("prefetch") ?? false;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { code } = await params;
  const sql = await getAppSql();
  const result = await resolveShortLink(sql, code, isPrefetch(request));
  if (!result) {
    return new NextResponse("Tautan tidak ditemukan.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(null, {
    status: 302,
    headers: {
      location: result.location,
      vary: "next-router-prefetch, purpose, sec-purpose",
    },
  });
}
