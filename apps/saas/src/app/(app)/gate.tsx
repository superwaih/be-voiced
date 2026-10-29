import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";

/**
 * Nobody reaches the product without an account.
 *
 * A server component, so the check happens before anything renders and there is no flash of an
 * app that then disappears. It runs once per navigation into the group.
 */
export async function requireSignedIn() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}
