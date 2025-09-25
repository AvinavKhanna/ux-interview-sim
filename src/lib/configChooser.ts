// src/lib/configChooser.ts
// Map a persona's gender and age into one of six voice configuration IDs
// provided via environment variables.

export type PersonaLike = {
  age?: number | null;
  gender?: string | null; // optional direct property if present
  demographics?: { gender?: string | null } | null;
};

function normGender(p?: PersonaLike): 'male' | 'female' | undefined {
  const raw = (p?.gender ?? p?.demographics?.gender ?? '').toString().toLowerCase();
  if (!raw) return undefined;
  if (raw.startsWith('m')) return 'male';
  if (raw.startsWith('f')) return 'female';
  return undefined;
}

function band(age?: number | null): 'YOUNG' | 'MID' | 'OLD' {
  const a = typeof age === 'number' && isFinite(age) ? age : 35;
  if (a < 30) return 'YOUNG';
  if (a < 55) return 'MID';
  return 'OLD';
}

export function chooseConfigId(persona: PersonaLike): string | undefined {
  const g = normGender(persona);
  const b = band(persona.age);

  const env = process.env;

  // Helper to safely read env
  const get = (key: string) => (env[key] && String(env[key]).trim()) || undefined;

  const keysByGender: Record<'male'|'female', Record<'YOUNG'|'MID'|'OLD', string>> = {
    male: {
      YOUNG: 'HUME_CFG_MALE_YOUNG',
      MID: 'HUME_CFG_MALE_MID',
      OLD: 'HUME_CFG_MALE_OLD',
    },
    female: {
      YOUNG: 'HUME_CFG_FEMALE_YOUNG',
      MID: 'HUME_CFG_FEMALE_MID',
      OLD: 'HUME_CFG_FEMALE_OLD',
    },
  };

  if (g) {
    return get(keysByGender[g][b]);
  }

  // Unknown gender: fall back to female for a neutral tone, else male
  const pref = get(keysByGender.female[b]) || get(keysByGender.male[b]);
  return pref || undefined;
}

// Minimal, dependency-free unit test that can be run with ts-node if desired.
// Not executed by the app; included for quick verification.
if (require.main === module) {
  process.env.HUME_CFG_MALE_YOUNG = 'MY';
  process.env.HUME_CFG_MALE_MID = 'MM';
  process.env.HUME_CFG_MALE_OLD = 'MO';
  process.env.HUME_CFG_FEMALE_YOUNG = 'FY';
  process.env.HUME_CFG_FEMALE_MID = 'FM';
  process.env.HUME_CFG_FEMALE_OLD = 'FO';

  const a = chooseConfigId({ age: 25, gender: 'male' });
  const b = chooseConfigId({ age: 40, gender: 'male' });
  const c = chooseConfigId({ age: 60, gender: 'female' });
  const d = chooseConfigId({ age: 35, gender: undefined });
  console.log('TEST chooseConfigId:', { a, b, c, d });
}

