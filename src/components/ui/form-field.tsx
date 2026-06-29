type FieldProps = {
  label: string;
  name: string;
  helper?: string;
};

export function FormField({ label, name, helper, ...props }: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <input
        name={name}
        className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        {...props}
      />
      {helper ? <span className="mt-1 block text-xs text-[#6B747B]">{helper}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  name,
  helper,
  children,
  ...props
}: FieldProps & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <select
        name={name}
        className="mt-1 h-11 w-full border border-[#B9C3C8] bg-white px-3 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        {...props}
      >
        {children}
      </select>
      {helper ? <span className="mt-1 block text-xs text-[#6B747B]">{helper}</span> : null}
    </label>
  );
}

export function TextareaField({
  label,
  name,
  helper,
  ...props
}: FieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#26323A]">{label}</span>
      <textarea
        name={name}
        className="mt-1 min-h-28 w-full border border-[#B9C3C8] bg-white px-3 py-2 text-sm text-[#26323A] outline-none focus:border-[#2F8FB3]"
        {...props}
      />
      {helper ? <span className="mt-1 block text-xs text-[#6B747B]">{helper}</span> : null}
    </label>
  );
}
