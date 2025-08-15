'use client';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, Labeled, Page, Pill } from '@/components/UI';
import * as React from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  function fakeLogin(e: React.FormEvent) {
    e.preventDefault();
    router.push('/projects');
  }

  return (
    <Page title="Welcome">
      <Card className="p-6">
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-semibold">Practice real UX interviews</h2>
            <p className="text-sm text-gray-700 mt-2">
              Talk to emotionally responsive AI personas, get real-time coaching cues,
              and leave with transcripts & analytics.
            </p>
            <ul className="mt-4 text-sm text-gray-700 space-y-1">
              <li>• Voice & text interviews</li>
              <li>• Suggested & custom personas</li>
              <li>• Post-session insights & export</li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Pill tone="blue">Prototype</Pill>
              <Pill tone="green">Student-friendly</Pill>
            </div>
          </div>

          <form onSubmit={fakeLogin} className="grid gap-3">
            <Labeled label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </Labeled>
            <Labeled label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Labeled>
            <div className="flex gap-2 pt-2">
              <Button type="submit">Log in →</Button>
              <Button variant="subtle" type="button" onClick={() => router.push('/projects')}>
                Continue as guest
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </Page>
  );
}