-- Storage: avatars bucket RLS policies
-- Run AFTER manually creating the 'avatars' bucket in Supabase Dashboard → Storage
-- Bucket settings: Public = true, Max file size = 2097152 (2MB)
--
-- Applied: 2026-02-21

-- Allow authenticated users to upload avatars
CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- Allow authenticated users to overwrite their own avatar (needed for upsert: true)
CREATE POLICY "Authenticated users can update avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars');

-- Allow public read of all avatars (so profile photos show to all users)
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'avatars');
