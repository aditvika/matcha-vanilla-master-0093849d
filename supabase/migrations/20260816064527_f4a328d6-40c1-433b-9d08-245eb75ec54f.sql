CREATE POLICY "Users manage own media uploads"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'mv-media' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'mv-media' AND auth.uid()::text = (storage.foldername(name))[1]);