import { createClient } from "@supabase/supabase-js";
import { FRONTEND_ENVIRONMENTS } from "../utils/constants";

const environment = process.env.NODE_ENV || "DEV";
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseApiKey = process.env.SUPABASE_API_KEY!;

// Create a Supabase client with the service key for admin operations
export const supabase = createClient(supabaseUrl, supabaseApiKey);

export async function verifyToken(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw error;
  return data.user;
}

export async function createUser(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo:
        environment === "PROD"
          ? FRONTEND_ENVIRONMENTS.PROD + "/login"
          : FRONTEND_ENVIRONMENTS.DEV + "/login",
    },
  });
  if (error) throw error;
  return data.user;
}
