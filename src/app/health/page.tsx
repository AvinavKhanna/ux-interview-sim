"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function HealthPage() {
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data, error, status } = await supabase
        .from("projects")
        .select("*")
        .limit(1);

      setResult({ status, hasData: !!data?.length, error: error?.message ?? null });
    })();
  }, []);

  return (
    <pre style={{ padding: 16 }}>
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}