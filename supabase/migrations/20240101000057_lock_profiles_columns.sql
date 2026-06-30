-- C3 fix: profiles had over-broad table-level UPDATE/DELETE/TRUNCATE granted to authenticated,
-- letting any user change their own role/balance/is_approved/etc. Revoke the broad grant and
-- re-grant UPDATE only on columns the client legitimately edits. RLS still gates row ownership.
REVOKE UPDATE, DELETE, TRUNCATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, business_name, avatar_url, document_url, is_online, updated_at, rejected_at, rejection_reason, expo_push_token)
ON public.profiles TO authenticated;
