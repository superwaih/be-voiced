import type { Metadata } from "next";
import { ClipEditorScreen } from "./ClipEditorScreen";

export const metadata: Metadata = { title: "Edit clip" };

export default async function ClipPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = await params;
  return <ClipEditorScreen id={id} clipId={clipId} />;
}
