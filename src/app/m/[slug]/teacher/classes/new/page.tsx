import { TeacherProgramCreatePage } from "@/components/pages/page-views";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TeacherProgramCreatePage slug={slug} />;
}
