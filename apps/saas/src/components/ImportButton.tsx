"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { chooseAndImport } from "@/lib/actions";

/**
 * Pick a recording and open it. Every screen that offers an import uses this, so the file picker,
 * the busy state and where you land afterwards are the same wherever you start.
 */
export function ImportButton({
  children = "Import recording",
  variant = "primary",
  size = "md",
}: {
  children?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant={variant}
      size={size}
      icon={<UploadSimple />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const id = await chooseAndImport();
          if (id) router.push(`/project/${id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
