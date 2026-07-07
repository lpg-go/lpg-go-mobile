-- RLS policies for the public 'images' storage bucket — lock down writes.
--
-- NOTE: This migration was applied live via the Supabase dashboard/SQL editor.
-- It is committed here for parity and version history only — do NOT re-apply.
-- Mirrors the 'documents' bucket policy tracked in admin migration 000063.
--
-- NOTE: The 'images' bucket itself is created MANUALLY in the Supabase dashboard
-- and is PUBLIC-READ (avatars, brand logos, and product images are served via
-- getPublicUrl). Only writes are restricted here — there is deliberately no
-- SELECT policy, because reads are public.
--
-- Path conventions written to this bucket:
--   avatars/<uid>/profile.jpg   — mobile customer/provider self-service upload.
--                                 The owner uid is the SECOND path segment, so
--                                 the owner check uses (storage.foldername(name))[2]
--                                 (NOT [1] as in the documents bucket, whose
--                                 convention is <uid>/... with the uid first).
--   avatars/<uid>.<ext>         — admin panel avatar upload (uid is in the
--                                 filename, not a folder — admin-only).
--   brands/<brandId|new>/...    — admin panel brand logos (admin-only).
--   products/<productId|new>/...— admin panel product images (admin-only).
--
-- A user may write only under their own avatars/<uid>/ folder; admins may write
-- anywhere in the bucket (covering the flat admin avatar path + brands/ +
-- products/). public.is_admin() is the same helper used by the documents policy.

-- 1. Remove the blanket "any authenticated user can write" policies that shipped
--    with the bucket's default dashboard configuration.
drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Allow authenticated update" on storage.objects;
drop policy if exists "Allow authenticated delete" on storage.objects;

-- 2. Owner-or-admin write policies. Each CREATE is preceded by a matching
--    DROP IF EXISTS so this migration is re-runnable without an "already
--    exists" error.
drop policy if exists "images_insert_owner_or_admin" on storage.objects;
create policy "images_insert_owner_or_admin" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'images' and (
      ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)
      or public.is_admin()
    )
  );

drop policy if exists "images_update_owner_or_admin" on storage.objects;
create policy "images_update_owner_or_admin" on storage.objects for update to authenticated
  using (
    bucket_id = 'images' and (
      ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)
      or public.is_admin()
    )
  );

drop policy if exists "images_delete_owner_or_admin" on storage.objects;
create policy "images_delete_owner_or_admin" on storage.objects for delete to authenticated
  using (
    bucket_id = 'images' and (
      ((storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = auth.uid()::text)
      or public.is_admin()
    )
  );
