import { supabase } from "@/integrations/supabase/client";

/** Uploads the picked file into the user's private folder and returns its path. */
export async function uploadSourceMedia(file: File, userId: string): Promise<string> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${userId}/src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("mv-media")
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/** Uploads a locally processed fallback and returns its private storage path. */
export async function uploadProcessedMedia(
  blob: Blob,
  userId: string,
  extension: string,
  contentType: string,
): Promise<string> {
  const path = `${userId}/out-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const { error } = await supabase.storage
    .from("mv-media")
    .upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
  return path;
}
