/** GitHub Pages 하위 경로(/저장소이름/)를 포함한 앱 주소 */
export function appBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

/** 학부모 초대 링크. 이름·전화번호 같은 개인정보는 넣지 않는다. */
export function invitationUrl(token: string): string {
  return `${appBaseUrl()}#/s/${token}`;
}

/** datetime-local 값(서울 기준) → ISO 문자열 */
export function seoulLocalToIso(local: string): string | null {
  if (!local) return null;
  return `${local.length === 16 ? `${local}:00` : local}+09:00`;
}

/** ISO → datetime-local 값(서울 기준) */
export function isoToSeoulLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
