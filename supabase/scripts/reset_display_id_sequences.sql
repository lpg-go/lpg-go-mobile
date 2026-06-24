-- ============================================================================
-- Reset display_id sequences
-- ============================================================================
-- Run this AFTER wiping test data and BEFORE launching to real users, so the
-- first real customer/dealer/rider/admin starts at 00001 again.
--
-- NOTE: this only resets the sequences. It does NOT clear display_id values on
-- existing rows — run it against a profiles table that has already been wiped
-- (or whose rows you intend to renumber separately).
-- ============================================================================

alter sequence public.seq_display_id_customer restart with 1;
alter sequence public.seq_display_id_dealer restart with 1;
alter sequence public.seq_display_id_rider restart with 1;
alter sequence public.seq_display_id_admin restart with 1;
