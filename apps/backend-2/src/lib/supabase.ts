import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Bun.env.SUPABASE_URL;
const supabaseKey = Bun.env.SUPABASE_API_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_API_KEY must be set");
}
const supabase = createClient(supabaseUrl, supabaseKey);

export const uploadFile = async (file: File) => {
  const { data, error } = await supabase.storage
    .from("storage")
    .upload(`statements/${file.name}_${Date.now()}`, file, {
      cacheControl: "3600",
      upsert: true, // Set true if you want to overwrite existing files
    });

  if (error) {
    console.error("Upload error:", error);
    return null;
  }

  console.log("Uploaded file path:", data?.path);
  return data?.path;
};
export const getSignedUrl = async (path: string, expiresIn: number) => {
  const { data, error } = await supabase.storage
    .from("your-bucket-name")
    .createSignedUrl(path, expiresIn); // 60 seconds

  if (error) {
    console.error("Signed URL error:", error);
    return null;
  }

  return data?.signedUrl;
};
