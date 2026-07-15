import { cn } from "@/lib/utils";
import { TransitionBackButton } from "@/components/layout/transition-link";
import type { ReactNode } from "react";

export function PageTitleBar({
  title,
  action,
  backHref,
  backLabel = "Back",
  tone = "blue",
  centerBackTitle,
  smallTitle,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  backHref?: string;
  backLabel?: string;
  tone?: "white" | "blue" | "teal";
  centerBackTitle?: boolean;
  smallTitle?: boolean;
}) {
  const shouldCenterBackTitle = centerBackTitle ?? Boolean(backHref);
  const shouldUseSmallTitle = smallTitle ?? true;
  const bandClass =
    tone === "white"
      ? "bg-white text-[#26323A]"
      : "bg-[radial-gradient(circle_at_top_left,#E5FFF0_0,#D6F7E8_30%,#7ECFC2_62%,#2E9B82_100%)] text-[#26323A]";

  return (
    <section className={cn(tone === "white" ? "border-b border-[#D6DCE0]" : "", bandClass)}>
      <div
        className={cn(
          "app-container relative flex min-h-60 flex-col justify-start gap-2 pb-32 md:min-h-64 md:pb-32",
          backHref ? "pt-32 md:pt-32" : "pt-0 md:pt-0",
          backHref ? (shouldCenterBackTitle ? "items-center px-14 text-center" : "items-start px-7 text-left") : "items-center text-center",
        )}
      >
        {backHref ? (
          <div className={cn("flex w-full items-center gap-3", shouldCenterBackTitle ? "justify-center" : "translate-y-12")} style={shouldCenterBackTitle ? { transform: "translateY(23px)" } : undefined}>
            <TransitionBackButton
              fallbackHref={backHref}
              label={backLabel}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#111827] shadow-[0_8px_18px_rgba(38,50,58,0.14)] ring-1 ring-white/80 transition-colors hover:bg-[#F7FBFC]",
                shouldCenterBackTitle && "absolute left-7",
              )}
            />
            <h1 className={cn("font-semibold leading-none tracking-normal", shouldUseSmallTitle ? "text-2xl md:text-3xl" : "text-[2.15rem] md:text-5xl")}>{title}</h1>
          </div>
        ) : null}
        {!backHref ? (
        <div className="w-full">
          <h1
            className={cn("font-medium leading-none tracking-normal", shouldUseSmallTitle ? "text-2xl md:text-3xl" : "text-[2.35rem] md:text-5xl")}
            style={{ transform: "translateY(28px)" }}
          >
            {title}
          </h1>
        </div>
        ) : null}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}
