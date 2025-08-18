'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/onboarding';
import type { Persona, TechLevel, Personality } from '@/types';
import { Button, Input, Labeled, Page, Select, Slider, TextArea, Card } from '@/components/UI';

function mapTechFromLevel(n: number): TechLevel {
  if (n <= 2) return 'low';
  if (n === 3) return 'medium';
  return 'high';
}
function levelFromTech(t: TechLevel) { return t === 'low' ? 1 : t === 'medium' ? 3 : 5; }

export default function CustomisePersonaPage() {
  const router = useRouter();
  const { selected, setSelected } = useOnboarding();

  const [name, setName] = React.useState<string>(selected?.name ?? '');
  const [age, setAge] = React.useState<number>(selected?.age ?? 35);
  const [occupation, setOccupation] = React.useState<string>(selected?.occupation ?? '');
  const [techLevel, setTechLevel] = React.useState<number>(levelFromTech(selected?.techFamiliarity ?? 'medium'));
  const [personality, setPersonality] = React.useState<Personality>(selected?.personality ?? 'friendly');
  const [painPoints, setPainPoints] = React.useState<string>((selected?.painPoints ?? []).join('\n'));
  const [notes, setNotes] = React.useState<string>(selected?.notes ?? '');
  const [saving, setSaving] = React.useState(false);

  async function save() {
  setSaving(true);
  try {
    const nameClean = (name || '').trim();
    const occClean = (occupation || '').trim();
    const pp = painPoints.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);

    const payload = {
      name: nameClean || 'Unnamed',
      age: Number.isFinite(age) ? age : 35,
      occupation: occClean || 'Participant', // better default than "Unknown"
      techFamiliarity: mapTechFromLevel(techLevel) as TechLevel,
      personality,
      painPoints: pp,
      notes: (notes || '').trim(),
    };

    const res = await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data: any = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      alert(data?.error || 'Failed to save persona');
      return;
    }

    const val = (v: any) => (v === null || v === undefined ? undefined : v);

    // Prefer client occupation if server gave empty or "Unknown"
    const serverOccRaw = val(data.occupation);
    const serverOcc =
      (typeof serverOccRaw === 'string' ? serverOccRaw.trim() : '') || '';
    const finalOcc =
      serverOcc && serverOcc.toLowerCase() !== 'unknown'
        ? serverOcc
        : payload.occupation;

    // Prefer client tech if server gave invalid value
    const serverTech = val(data.techFamiliarity);
    const allowedTech = ['low', 'medium', 'high'];
    const finalTech = allowedTech.includes(serverTech as string)
      ? (serverTech as TechLevel)
      : payload.techFamiliarity;

    const persona: Persona = {
      id: val(data.id) ?? selected?.id ?? `custom-${Date.now()}`,
      name: typeof val(data.name) === 'string' && val(data.name).trim()
        ? val(data.name).trim()
        : payload.name,
      age: Number.isFinite(val(data.age)) ? Number(val(data.age)) : payload.age,
      occupation: finalOcc,                          // <-- your value wins
      techFamiliarity: finalTech,                    // <-- your slider wins
      personality: (['friendly','guarded','analytical','impatient'].includes(val(data.personality))
        ? val(data.personality)
        : payload.personality) as Personality,
      painPoints: Array.isArray(val(data.painPoints)) ? val(data.painPoints) : payload.painPoints,
      notes: typeof val(data.notes) === 'string' ? val(data.notes) : payload.notes,
      created_at: typeof val(data.created_at) === 'string'
        ? val(data.created_at)
        : new Date().toISOString(),
    };

    setSelected(persona);
    router.push('/sessions/summary');
  } finally {
    setSaving(false);
  }
}

  return (
    <Page title="Customise Persona">
      <div className="max-w-6xl mx-auto">
        <Card className="p-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid gap-6">
              <Labeled label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Labeled>

              <Labeled label={`Age: ${age}`}>
                <Slider min={16} max={85} value={age} onChange={setAge} />
                <div className="text-xs text-gray-500 mt-1">Low &nbsp;&nbsp; Medium &nbsp;&nbsp; High</div>
              </Labeled>

              <Labeled label="Occupation">
                <Input value={occupation} onChange={(e) => setOccupation(e.target.value)} />
              </Labeled>

              <Labeled label="Tech familiarity">
                <div>
                  <Slider min={1} max={5} value={techLevel} onChange={setTechLevel} />
                  <div className="text-xs text-gray-600 mt-1">Selected: {mapTechFromLevel(techLevel)}</div>
                </div>
              </Labeled>

              <Labeled label="Personality">
                <Select
                  value={personality}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setPersonality(e.target.value as Personality)
                  }
                >
                  <option value="friendly">Friendly</option>
                  <option value="guarded">Guarded</option>
                  <option value="analytical">Analytical</option>
                  <option value="impatient">Impatient</option>
                </Select>
              </Labeled>
            </div>

            <div className="grid gap-6">
              <Labeled label="Extra instructions (optional)">
                <TextArea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything this persona should reveal or avoid…"
                />
              </Labeled>

              <Labeled label="Pain points (one per line)">
                <TextArea
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  placeholder="e.g. Struggles with verification steps"
                />
              </Labeled>
            </div>
          </div>
        </Card>

        <div className="flex gap-3 mt-6">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Persona'}
          </Button>
          <Button variant="ghost" onClick={() => router.back()}>
            ← Back
          </Button>
        </div>
      </div>
    </Page>
  );
}