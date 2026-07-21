export function EmptyState({
  title,
  text,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  text: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#22A6B3] text-3xl font-medium text-[#22A6B3]">!</div>
      <h3 className="mt-4 text-base font-medium text-[#26323A]">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-[#6B747B]">{text}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-[#22A6B3] px-5 text-sm font-semibold !text-white transition-colors hover:bg-[#1C8A95]"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
