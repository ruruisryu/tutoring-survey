// 휴대전화 번호: 하이픈·공백·괄호·+82 를 받아 숫자만 남긴다 (서버 normalize_phone 과 같은 규칙)

export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!/^[0-9+()\s.-]{9,20}$/.test(raw)) return null;
  let d = raw.replace(/[^0-9]/g, '');
  if (raw.startsWith('+')) {
    if (!d.startsWith('82')) return null;
    d = '0' + d.slice(2);
  }
  return /^01[016789][0-9]{7,8}$/.test(d) ? d : null;
}

export function formatPhone(digits: string): string {
  if (/^01[016789][0-9]{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^01[016789][0-9]{7}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

/** 목록용: 010-****-5678 */
export function maskPhone(digits: string): string {
  const f = formatPhone(digits);
  const parts = f.split('-');
  if (parts.length !== 3) return digits.slice(0, 3) + '****' + digits.slice(-4);
  return `${parts[0]}-${'*'.repeat(parts[1].length)}-${parts[2]}`;
}
