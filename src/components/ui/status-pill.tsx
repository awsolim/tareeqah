import type { Status } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const statusClasses: Record<Status, string> = {
  Open: "border-[#2F8FB3] bg-[#E7F3F8] text-[#257B9C]",
  Pending: "border-[#F59E0B] bg-[#FFF7E8] text-[#9A5F00]",
  Confirmed: "border-[#22A6B3] bg-[#EAF8FA] text-[#16747D]",
  Waitlisted: "border-[#F59E0B] bg-[#FFF7E8] text-[#9A5F00]",
  Present: "border-[#2F8FB3] bg-[#E7F3F8] text-[#257B9C]",
  Absent: "border-[#E25241] bg-[#FDEDEA] text-[#B33427]",
  Late: "border-[#F59E0B] bg-[#FFF7E8] text-[#9A5F00]",
  Closed: "border-[#AEB7BD] bg-[#F2F4F5] text-[#6B747B]",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("inline-flex border px-2.5 py-1 text-xs font-medium uppercase tracking-wide", statusClasses[status], className)}>
      {status}
    </span>
  );
}
