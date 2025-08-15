// src/app/page.tsx
// Do NOT add "use client" here; this must be a server component
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/login'); // server-side redirect
  return null;        // satisfies return type
}