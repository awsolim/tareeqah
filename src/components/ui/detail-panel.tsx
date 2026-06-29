export function DetailPanel({
  title,
  rows,
  children,
}: {
  title: string;
  rows?: Array<{ label: string; value: React.ReactNode }>;
  children?: React.ReactNode;
}) {
  return (
    <section className="border border-[#D6DCE0] bg-white">
      <header className="border-b border-[#D6DCE0] px-4 py-3">
        <h2 className="text-base font-medium text-[#26323A]">{title}</h2>
      </header>
      {rows ? (
        <dl className="divide-y divide-[#D6DCE0]">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-[#6B747B]">{row.label}</dt>
              <dd className="text-[#26323A]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </section>
  );
}
