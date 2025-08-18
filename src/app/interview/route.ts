// src/app/interview/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  // This would serve if someone navigates directly to /interview
  return NextResponse.json({ message: "This is the /interview page, not the API" });
}