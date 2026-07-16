// Pure formatting helpers shared across the app. No React, no Supabase — keep
// this module free of side effects so any screen or component can import it.

/**
 * Initials from the first + last word of a name, uppercased, max 2 chars.
 * Falls back to "?" when there's no usable name.
 * e.g. "John Smith" → "JS", "John Michael Smith" → "JS", "Madonna" → "M".
 */
export function getInitials(name?: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Formats a peso amount: "₱1,234". Uses en-PH grouping and shows decimals only
 * when the value has them (minimumFractionDigits: 0). Coerces with Number() so
 * DB numerics that arrive as strings still format.
 */
export function peso(n: number): string {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0 })}`;
}

/**
 * Relative "time ago" label for an ISO timestamp, read against the current time.
 *
 * - `'short'` → terse: "just now" / "5m ago" / "3h ago" / "2d ago" / "5mo ago".
 * - `'long'`  → verbose: "just now" / "5 minutes ago" / "2 days ago" / "1 month ago".
 *
 * Both styles handle months so neither renders values like "400d ago".
 */
export function timeAgo(iso: string, style: 'short' | 'long' = 'long'): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));

  if (style === 'short') {
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return `${Math.floor(diff / 2592000)}mo ago`;
  }

  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 120) return '1 minute ago';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 7200) return '1 hour ago';
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return '1 day ago';
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 5184000) return '1 month ago';
  return `${Math.floor(diff / 2592000)} months ago`;
}

/**
 * Formats a stored PH phone number for display: "+63 917 123 4567".
 * Expects a 12-digit 63XXXXXXXXXX (with or without punctuation / leading +).
 * Returns the input unchanged when it doesn't match that shape.
 */
export function formatPhoneForDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('63') && d.length === 12) {
    return `+63 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  return phone;
}
