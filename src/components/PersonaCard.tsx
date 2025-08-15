'use client';
import { Persona } from '@/context/onboarding';
import { Button, Card, Pill } from './UI';

export function PersonaCard({
  persona,
  onSelect,
  onCustomise,
  highlight = false
}: {
  persona: Persona;
  onSelect: (p: Persona) => void;
  onCustomise: (p: Persona) => void;
  highlight?: boolean;
}) {
  const techTone =
    persona.techFamiliarity === 'high' ? 'green' :
    persona.techFamiliarity === 'medium' ? 'blue' : 'orange';

  return (
    <Card className={`p-4 border-l-4 border-indigo-600 transition-transform hover:translate-y-[1px] hover:shadow-sm ${highlight ? 'ring-2 ring-indigo-600' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-lg">{persona.name}, {persona.age}</div>
          <div className="text-sm text-gray-700">{persona.occupation}</div>
        </div>
        <Pill tone={techTone}>{persona.techFamiliarity} tech</Pill>
      </div>

      <div className="mt-3">
        <div className="text-xs font-medium mb-1">Key pain points</div>
        <ul className="text-sm list-disc pl-5 space-y-1">
          {persona.painPoints.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>

      <div className="mt-4 flex gap-2">
        <Button onClick={() => onSelect(persona)}>Select Persona</Button>
        <Button variant="ghost" onClick={() => onCustomise(persona)}>Customise</Button>
      </div>
    </Card>
  );
}