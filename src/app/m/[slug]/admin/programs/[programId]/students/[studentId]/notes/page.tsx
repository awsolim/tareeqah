import { AdminStudentNotesPage } from "@/components/pages/page-views";

export default async function Page({ params }: { params: Promise<{ slug: string; programId: string; studentId: string }> }) {
  const { slug, programId, studentId } = await params;
  return <AdminStudentNotesPage slug={slug} programId={programId} studentId={studentId} />;
}
