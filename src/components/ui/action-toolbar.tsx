import { FlatButton } from "@/components/ui/flat-button";

export function ActionToolbar({ actions }: { actions: Array<{ label: string; variant?: "toolbar" | "success" | "danger" | "primary" }> }) {
  return (
    <div className="overflow-x-auto border-y border-[#D6DCE0] bg-[#E8E8E8] px-3 py-2">
      <div className="flex min-w-max gap-2">
        {actions.map((action) => (
          <FlatButton key={action.label} variant={action.variant ?? "toolbar"} className="min-h-9 px-3">
            {action.label}
          </FlatButton>
        ))}
      </div>
    </div>
  );
}
