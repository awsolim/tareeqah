export function NoticePanel({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "info" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-[#2F8FB3] bg-[#E7F3F8]"
      : tone === "warning"
        ? "border-[#F59E0B] bg-[#FFF7E8]"
        : "border-[#22A6B3] bg-[#EAF8FA]";

  return (
    <section className={`border-l-4 ${toneClass} px-4 py-3`}>
      <h2 className="text-sm font-medium text-[#26323A]">{title}</h2>
      <div className="mt-1 text-sm text-[#26323A]">{children}</div>
    </section>
  );
}
