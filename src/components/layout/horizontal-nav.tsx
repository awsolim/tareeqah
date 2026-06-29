"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = {
  label: string;
  href: string;
};

export function HorizontalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={`${item.label}-${item.href}`}
            href={item.href}
            className={cn(
              "border border-transparent px-3 py-2 text-sm font-medium text-[#26323A] hover:bg-[#F2F4F5]",
              active && "border-[#D6DCE0] bg-[#E7F3F8] text-[#2F8FB3]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
