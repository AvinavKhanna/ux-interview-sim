// src/app/page.tsx
// Server component: simplified Welcome page with a single Start button
import Link from 'next/link';
import { Page as Screen, Card, Button, Pill } from '@/components/UI';

export default function Home() {
  return (
    <Screen title="Welcome">
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

          <div className="grid content-start gap-3">
            <Link href="/projects" prefetch>
              <Button type="button">Start</Button>
            </Link>
          </div>
        </div>
      </Card>
    </Screen>
  );
}
