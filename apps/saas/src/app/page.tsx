import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { LandingScreen } from "./LandingScreen";

/**
 * The public front door.
 *
 * Signed out, this is the landing page. Signed in, there is nothing to sell, so it goes straight
 * to the library — the app's own home moved to `/home` to free this route.
 */
export default async function RootPage() {
  const user = await currentUser();
  if (user) redirect("/home");
  return <LandingScreen />;
}
