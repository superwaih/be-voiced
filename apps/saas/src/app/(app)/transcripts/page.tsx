import type { Metadata } from "next";
import { TranscriptsScreen } from "./TranscriptsScreen";

export const metadata: Metadata = { title: "Transcripts" };

export default function TranscriptsPage() {
  return <TranscriptsScreen />;
}
