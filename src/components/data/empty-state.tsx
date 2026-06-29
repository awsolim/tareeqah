export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#22A6B3] text-3xl font-medium text-[#22A6B3]">!</div>
      <h3 className="mt-4 text-base font-medium text-[#26323A]">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-[#6B747B]">{text}</p>
    </div>
  );
}
