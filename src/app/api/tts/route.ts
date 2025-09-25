import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Deprecated — replaced by Hume EVI soon.
export async function POST() {
  return NextResponse.json(
    { message: 'Deprecated — replaced by Hume EVI soon.' },
    { status: 410 }
  );
}
