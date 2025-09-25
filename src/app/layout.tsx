// src/app/layout.tsx
import './globals.css';
import Link from 'next/link';
import { OnboardingProvider } from '@/context/onboarding';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gradient-to-br from-indigo-50 to-white text-slate-900">
        <header className="border-b bg-white/70 backdrop-blur">
          <nav className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight">UX Interview Simulator</Link>
            <div className="flex gap-4 text-sm">
              <Link href="/login" className="hover:underline">Login</Link>
              <Link href="/projects" className="hover:underline">Project</Link>
              <Link href="/personas" className="hover:underline">Personas</Link>
              <Link href="/sessions/summary" className="hover:underline">Summary</Link>
            </div>
          </nav>
        </header>
        <OnboardingProvider>
          <main>{children}</main>
        </OnboardingProvider>
      </body>
    </html>
  );
}
