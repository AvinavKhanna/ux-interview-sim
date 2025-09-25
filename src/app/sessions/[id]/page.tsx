import StartInterviewClient from './StartInterviewClient';

type PageProps = {
  params: Promise<{ id: string }>; // Next 15: params is async
};

export default async function StartInterviewPage({ params }: PageProps) {
  const { id } = await params; // await params per Next 15 guidance
  if (!id) return <div className="p-6">Missing session id.</div>;
  return <StartInterviewClient sessionId={id} />;
}
