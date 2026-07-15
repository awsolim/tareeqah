import { AdminInstructorsPage } from "@/components/pages/page-views";

export default async function Page({ params }: { params: Promise<{ slug: string; programId: string }> }) {
  const { slug, programId } = await params;
  return <AdminInstructorsPage slug={slug} programId={programId} />;
}
