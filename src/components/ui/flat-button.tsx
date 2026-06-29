import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "toolbar" | "ghost" | "danger" | "dangerOutline" | "success";

const variantClasses: Record<Variant, string> = {
  primary: "border-[#2F8FB3] bg-[#2F8FB3] !text-white hover:bg-[#257B9C]",
  secondary: "border-[#B9C3C8] bg-white text-[#26323A] hover:bg-[#F7F8F9]",
  toolbar: "border-[#B8BFC4] bg-white text-[#26323A] hover:bg-[#F7F8F9]",
  ghost: "border-transparent bg-transparent text-[#2F8FB3] hover:bg-white/70",
  danger: "border-[#E25241] bg-[#E25241] !text-white hover:bg-[#C83F31]",
  dangerOutline: "border-[#E25241] bg-white text-[#E25241] hover:bg-[#FDEDEA]",
  success: "border-[#2F8FB3] bg-[#2F8FB3] !text-white hover:bg-[#257B9C]",
};

type BaseProps = {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
};

export function FlatButton({
  children,
  variant = "secondary",
  className,
  ...props
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center border px-4 text-sm font-medium transition-colors disabled:opacity-50",
        variantClasses[variant],
        className,
      )}
      suppressHydrationWarning
      {...props}
    >
      {children}
    </button>
  );
}

export function FlatLink({
  children,
  href,
  variant = "secondary",
  className,
}: BaseProps & { href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-10 items-center justify-center border px-4 text-sm font-medium transition-colors",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
