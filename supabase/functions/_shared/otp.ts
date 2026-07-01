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
// Consume semantics (verbatim from verify-otp's prior inline logic):
//   - no unused OTP        -> { ok: false, error: 'Invalid or expired code.' }
//   - past expires_at      -> { ok: false, error: 'Code expired.' }
//   - attempts >= 5        -> { ok: false, error: 'Too many attempts. Please request a new code.' }
//   - correct code         -> mark used=true, { ok: true }
//   - wrong code           -> attempts++, burn (used=true) at the 5th failure,
//                             { ok: false, error: 'Incorrect code.' } (or the lockout msg at 5)
export async function verifyAndConsumeOtp(
  supabase: SupabaseClient,
  phone: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  // Fetch the latest unused OTP for this phone (NOT matched on code — we compare in
  // JS so we can count failed attempts against this specific row and lock it out).
  const { data, error } = await supabase
    .from('otp_verifications')
    .select('id, code, expires_at, attempts')
    .eq('phone', phone)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'Invalid or expired code.' };
  }

  if (new Date(data.expires_at) < new Date()) {
    return { ok: false, error: 'Code expired.' };
  }

  // Locked out — too many prior failures on this code.
  if ((data.attempts ?? 0) >= 5) {
    return { ok: false, error: 'Too many attempts. Please request a new code.' };
  }

  // Correct code — consume it.
  if (data.code === code) {
    await supabase
      .from('otp_verifications')
      .update({ used: true })
      .eq('id', data.id);

    return { ok: true };
  }

  // Wrong code — burn an attempt. At the 5th failure, also mark used to force a resend.
  const newAttempts = (data.attempts ?? 0) + 1;
  const locked = newAttempts >= 5;
  await supabase
    .from('otp_verifications')
    .update({ attempts: newAttempts, used: locked })
    .eq('id', data.id);

  if (locked) {
    return { ok: false, error: 'Too many attempts. Please request a new code.' };
  }

  return { ok: false, error: 'Incorrect code.' };
}
