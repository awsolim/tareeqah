import { AdminEnrollmentsPage } from "@/components/pages/page-views";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <AdminEnrollmentsPage slug={slug} />;
}
