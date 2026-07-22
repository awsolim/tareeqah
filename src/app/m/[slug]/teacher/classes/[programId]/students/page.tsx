import { TeacherStudentsPage } from "@/components/pages/page-views";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; programId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { slug, programId } = await params;
  const query = await searchParams;
  const fromValue = Array.isArray(query.from) ? query.from[0] : query.from;
  return <TeacherStudentsPage slug={slug} programId={programId} fromHome={fromValue === "home"} />;
}
