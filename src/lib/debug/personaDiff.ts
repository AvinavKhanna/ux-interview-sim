import type { PersonaSummary } from "@/lib/persona/normalize";

export function diffPersona(labelA: string, a: PersonaSummary | undefined, labelB: string, b: PersonaSummary | undefined) {
  if (process.env.NODE_ENV === "production") return;
  const pick = (p: PersonaSummary | undefined) => ({
    name: p?.name,
    age: p?.age,
    tech: (p as any)?.techFamiliarity,
    personality: p?.personality,
  });
  const A = pick(a || {} as any);
  const B = pick(b || {} as any);
  const sa = JSON.stringify(A);
  const sb = JSON.stringify(B);
  if (sa !== sb) {
    // eslint-disable-next-line no-console
    console.error("[persona:DIFF]", labelA, A, "!=", labelB, B);
  } else {
    // eslint-disable-next-line no-console
    console.log("[persona:OK]", labelA, "==", labelB, A);
  }
}

