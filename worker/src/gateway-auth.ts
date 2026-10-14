// Shared gateway authorization. Fails CLOSED when GATEWAY_TOKEN is unset and
// compares in constant time so the token cannot be recovered via timing.
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function isGatewayAuthorized(r: Request, e: any): boolean {
  const token = String(e?.GATEWAY_TOKEN || '').trim();
  if (!token) return false;
  return timingSafeEqualString(r.headers.get('Authorization') || '', `Bearer ${token}`);
}
