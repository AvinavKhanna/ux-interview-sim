import StartInterviewClient from "@/app/sessions/[id]/StartInterviewClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 15 requires awaiting params

  if (!id) {
    return <div className="p-6 text-red-600">Missing session id.</div>;
  }

  return <StartInterviewClient id={id} />;
}


