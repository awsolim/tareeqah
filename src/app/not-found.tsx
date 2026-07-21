import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F2F4F5] p-6">
      <div className="w-full max-w-[360px] rounded-[28px] bg-white p-7 text-center shadow-[0_24px_60px_rgba(38,50,58,0.12)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#E7F3F8] text-2xl font-extrabold text-[#2F8FB3]">
          ت
        </div>
        <h1 className="mt-5 text-2xl font-semibold leading-tight text-[#26323A]">Page not found</h1>
        <p className="mt-2.5 text-base leading-6 text-[#6B747B]">
          The page you are looking for does not exist or may have moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#26323A] px-5 text-sm font-semibold text-white"
        >
          Go to Home
        </Link>
      </div>
    </main>
  );
}
