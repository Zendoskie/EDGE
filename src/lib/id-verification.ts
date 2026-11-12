import { supabase } from "@/integrations/supabase/client";

export const ID_DOCUMENTS_BUCKET = "id-documents";

export type IdSide = "front" | "back";

export const ID_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** A fresh, unguessable folder for one applicant's ID images. */
export function newIdFolder(role: "staff" | "parent"): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  return `${role}/${id}`;
}

/** Client-side validation for an ID image. Returns an error message, or null when acceptable. */
export function validateIdImage(file: File | null | undefined): string | null {
  if (!file) return null;
  if (!file.type.startsWith("image/")) return "Only image files are allowed.";
  if (file.size > ID_IMAGE_MAX_BYTES) return "The image is too large (max 10 MB).";
  return null;
}

/** Upload one side of an ID into the private bucket. Returns the stored object path. */
export async function uploadIdImage(file: File, folder: string, side: IdSide): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${folder}/${side}.${ext}`;
  const { error } = await supabase.storage.from(ID_DOCUMENTS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Short-lived signed URL so an administrator can view a private ID image. */
export async function getSignedIdUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(ID_DOCUMENTS_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
