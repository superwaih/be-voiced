import { requireSignedIn } from "./gate";
import { Shell } from "./Shell";

/**
 * The product, behind a sign-in.
 *
 * This layer is a server component purely so the check runs before anything renders — no flash of
 * an app that then vanishes. Everything visual is in `Shell`, which is a client component.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSignedIn();
  return <Shell>{children}</Shell>;
}
