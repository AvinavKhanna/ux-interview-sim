import './globals.css';
import { OnboardingProvider } from '@/context/onboarding';
<a href="/login" className="font-semibold tracking-tight">UX Interview Simulator</a>

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-indigo-50 to-white text-slate-900">
        <header className="border-b bg-white/70 backdrop-blur">
          <nav className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <a href="/" className="font-semibold tracking-tight">UX Interview Simulator</a>
            <div className="flex gap-4 text-sm">
              <a href="/login" className="hover:underline">Login</a>
              <a href="/projects" className="hover:underline">Project</a>
              <a href="/personas" className="hover:underline">Personas</a>
              <a href="/sessions/summary" className="hover:underline">Summary</a>
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