import type { Metadata } from "next";
import { WorkspaceScreen } from "./WorkspaceScreen";

export const metadata: Metadata = { title: "Workspace" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceScreen id={id} />;
}
