import type { Metadata } from "next";
import { ProjectsScreen } from "./ProjectsScreen";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
