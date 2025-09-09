import { NextResponse } from 'next/server';

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}