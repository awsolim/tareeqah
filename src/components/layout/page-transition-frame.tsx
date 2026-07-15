"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavPreview = {
  href: string;
  label: string;
  direction: "from-right" | "from-left";
  fromPath: string;
  kind?: "home" | "classes" | "inbox" | "me" | "subpage";
};

export function PageTransitionFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [preview, setPreview] = useState<NavPreview | null>(null);
  const activePreview = preview && preview.fromPath === pathname ? preview : null;

  useEffect(() => {
    function handlePreview(event: Event) {
      const detail = (event as CustomEvent<NavPreview>).detail;
      if (!detail?.href || detail.href === pathname) {
        return;
      }

      setPreview(detail);
    }

    window.addEventListener("tareeqah:nav-preview", handlePreview);
    return () => window.removeEventListener("tareeqah:nav-preview", handlePreview);
  }, [pathname]);

  return (
    <main
      key={pathname}
      className={activePreview?.kind === "subpage" ? "pb-0 md:pb-0" : "pb-20 md:pb-0"}
    >
      {activePreview ? <InstantNavPreview preview={activePreview} /> : children}
    </main>
  );
}

function InstantNavPreview({ preview }: { preview: NavPreview }) {
  const title = preview.label === "Me" ? "Me" : preview.label;
  const slideClass = preview.direction === "from-right" ? "page-slide-in-from-right" : "page-slide-in-from-left";

  if (preview.label === "Me") {
    return (
      <div className={slideClass}>
        <GenericPreviewLoading />
      </div>
    );
  }

  return (
    <div className={slideClass}>
      <section className="bg-[radial-gradient(circle_at_top_left,#E5FFF0_0,#D6F7E8_30%,#7ECFC2_62%,#2E9B82_100%)] text-[#26323A]">
        <div className={preview.kind === "subpage" ? "app-container relative flex min-h-60 flex-col items-center justify-start px-14 pb-32 pt-32 text-center md:min-h-64 md:pt-32" : "app-container flex min-h-60 flex-col items-center justify-start pb-32 pt-0 text-center md:min-h-64 md:pt-0"}>
          {preview.kind === "subpage" ? (
            <div className="flex w-full items-center justify-center gap-3" style={{ transform: "translateY(23px)" }}>
              <span className="absolute left-7 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#111827] shadow-[0_8px_18px_rgba(38,50,58,0.14)] ring-1 ring-white/80">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                  <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h1 className="text-2xl font-semibold leading-none tracking-normal md:text-3xl">{title}</h1>
            </div>
          ) : (
            <h1 className="text-2xl font-medium leading-none tracking-normal md:text-3xl" style={{ transform: "translateY(28px)" }}>{title}</h1>
          )}
        </div>
      </section>
      <div className="relative z-10 min-h-[calc(100vh-260px)]" style={{ marginTop: "-172px" }}>
        <div className="min-h-[calc(100vh-260px)] overflow-hidden rounded-t-[34px] bg-[var(--workspace)]">
          <InstantPreviewContent preview={preview} />
        </div>
      </div>
    </div>
  );
}

function InstantPreviewContent({ preview }: { preview: NavPreview }) {
  void preview;
  return <GenericPreviewLoading />;
}

function GenericPreviewLoading() {
  return (
    <div className="flex min-h-[calc(100vh-260px)] items-center justify-center bg-[var(--workspace)] px-6 py-10" aria-label="Loading">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-11 w-11 animate-spin rounded-full border-4 border-[#DDEFF4] border-t-[#2F8FB3]" aria-hidden />
        <span className="text-sm font-semibold text-[#52616A]">Loading</span>
      </div>
    </div>
  );
}

