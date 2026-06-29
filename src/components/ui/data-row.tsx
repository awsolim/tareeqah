import { cn } from "@/lib/utils";

export type DataRowMeta = {
  label: string;
  value: React.ReactNode;
};

export function DataRow({
  title,
  subtitle,
  meta = [],
  status,
  action,
  leading,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: DataRowMeta[];
  status?: React.ReactNode;
  action?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-[#D6DCE0] bg-white px-4 py-3 last:border-b-0 md:flex md:items-center md:gap-4", className)}>
      {leading ? <div className="mb-3 shrink-0 md:mb-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-medium text-[#26323A]">{title}</h3>
          {status}
        </div>
        {subtitle ? <p className="mt-1 text-sm text-[#6B747B]">{subtitle}</p> : null}
      </div>
      {meta.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:mt-0 md:min-w-[360px] md:grid-cols-3">
          {meta.map((item) => (
            <div key={item.label}>
              <dt className="text-xs font-medium uppercase text-[#6B747B]">{item.label}</dt>
              <dd className="mt-0.5 text-[#26323A]">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {action ? <div className="mt-3 md:mt-0">{action}</div> : null}
    </div>
  );
}
