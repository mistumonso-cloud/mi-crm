"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";

export type LoginActionState = { error: string } | undefined;

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ipHint = (await headers()).get("x-forwarded-for") ?? undefined;

  const result = await fetchMutation(api.auth.login, { email, password, ipHint });

  if (!result.success) {
    return { error: result.error };
  }

  await setSessionCookie(result.token);
  redirect(result.role === "rep" ? "/pendientes" : "/panel");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await fetchMutation(api.auth.logout, { token });
  }
  await clearSessionCookie();
  redirect("/login");
}
