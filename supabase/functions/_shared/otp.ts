// Shared OTP utilities for Edge Functions.
//
// Both verify-otp (signup) and reset-password (C4) must consume an OTP with the
// exact same hardened logic — expiry window + 5-attempt lockout from migration
// 055. This is the single source of truth so the two paths can never drift.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Normalizes a raw phone to digits-only E.164 without '+', matching the form
// send-otp stores in otp_verifications.phone (e.g. "639XXXXXXXXX").
// Returns null for anything that isn't a valid PH mobile number.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) return digits;
  if (digits.startsWith('09') && digits.length === 11) return '63' + digits.slice(1);
  return null;
}

// Verifies a code against the latest unused OTP for `phone` and consumes it.
// `phone` MUST already be normalized (digits-only, via normalizePhone).
//
// The verify + consume is done in a single SECURITY DEFINER RPC (consume_otp,
// migration 064) that locks the target row with SELECT ... FOR UPDATE. That row
// lock is what makes the attempt increment atomic and closes the H6 race — the
// previous JS read-then-write let parallel requests both read attempts=4 and both
// proceed, defeating the 5-try lockout.
//
// Consume semantics (byte-identical to the prior inline logic):
//   - no unused OTP        -> { ok: false, error: 'Invalid or expired code.' }
//   - past expires_at      -> { ok: false, error: 'Code expired.' }
//   - attempts >= 5        -> { ok: false, error: 'Too many attempts. Please request a new code.' }
//   - correct code         -> mark used=true, { ok: true }
//   - wrong code           -> attempts++, burn (used=true) at the 5th failure,
//                             { ok: false, error: 'Incorrect code.' }
export async function verifyAndConsumeOtp(
  supabase: SupabaseClient,
  phone: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: status, error } = await supabase.rpc('consume_otp', {
    p_phone: phone,
    p_code: code,
  });

  // RPC failure — treat as no valid code (same as the prior fetch-error path).
  if (error) {
    return { ok: false, error: 'Invalid or expired code.' };
  }

  switch (status) {
    case 'ok':
      return { ok: true };
    case 'expired':
      return { ok: false, error: 'Code expired.' };
    case 'locked':
      return { ok: false, error: 'Too many attempts. Please request a new code.' };
    case 'incorrect':
      return { ok: false, error: 'Incorrect code.' };
    case 'not_found':
    default:
      return { ok: false, error: 'Invalid or expired code.' };
  }
}
