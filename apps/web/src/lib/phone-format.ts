/**
 * A stored phone number (E.164, "+6281200000000") the way people write it: "+62 812-0000-0000"
 * (UI tour run 14, R14-WB-13). Indonesian numbers only; the country code of any other number has no
 * fixed length, so those stay as stored. Display only: the server strips the spaces and hyphens again
 * when the number is saved (src/lib/phone-number.ts).
 */
export function formatPhone(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/\D+/g, "");
  let national: string | null = null;
  if (s.startsWith("+")) national = digits.startsWith("62") ? digits.slice(2) : null;
  else if (digits.startsWith("62")) national = digits.slice(2);
  else if (digits.startsWith("0")) national = digits.slice(1);
  if (national === null || national.length < 6 || national.length > 13 || /[^\d\s+().-]/.test(s)) return s;
  const head = national.slice(0, 3);
  const rest = national.slice(3);
  const r = rest.length;
  const sizes = r <= 4 ? [r] : r <= 8 ? [Math.ceil(r / 2), Math.floor(r / 2)] : r === 9 ? [3, 3, 3] : [4, 4, r - 8];
  const parts = [head];
  let i = 0;
  for (const n of sizes) { parts.push(rest.slice(i, i + n)); i += n; }
  return `+62 ${parts.filter(Boolean).join("-")}`;
}
