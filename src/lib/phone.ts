export const phoneCountryCodes = [
  { value: "+1", label: "CA/US +1" },
  { value: "+44", label: "UK +44" },
  { value: "+61", label: "AU +61" },
  { value: "+971", label: "UAE +971" },
  { value: "+966", label: "SA +966" },
  { value: "+20", label: "EG +20" },
  { value: "+92", label: "PK +92" },
  { value: "+91", label: "IN +91" },
];

export function normalizePhoneNumber(rawPhone: string, countryCode = "+1") {
  const trimmed = rawPhone.trim();
  const normalizedCode = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;

  if (!trimmed) {
    return { value: "", error: "Phone number is required." };
  }

  const hasExplicitCountryCode = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  const codeDigits = normalizedCode.replace(/\D/g, "");
  const nationalDigits = hasExplicitCountryCode && digits.startsWith(codeDigits) ? digits.slice(codeDigits.length) : digits;

  if (normalizedCode === "+1") {
    const tenDigits = nationalDigits.length === 11 && nationalDigits.startsWith("1") ? nationalDigits.slice(1) : nationalDigits;

    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits)) {
      return { value: "", error: "Enter a valid 10-digit Canada/US phone number." };
    }

    return { value: `+1${tenDigits}`, error: null };
  }

  const fullDigits = hasExplicitCountryCode ? digits : `${codeDigits}${nationalDigits}`;

  if (fullDigits.length < 8 || fullDigits.length > 15) {
    return { value: "", error: "Enter a valid phone number with country code." };
  }

  return { value: `+${fullDigits}`, error: null };
}
