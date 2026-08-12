"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isLocalAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign the current user out and send them to the login page. Clears the local
 * dev cookie or the Supabase session depending on the active auth mode. (The
 * client separately clears its localStorage mirror — see `dashboard-nav`.)
 */
export async function signOut() {
  if (isLocalAuthMode()) {
    (await cookies()).delete(LOCAL_SESSION_COOKIE);
  } else {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
