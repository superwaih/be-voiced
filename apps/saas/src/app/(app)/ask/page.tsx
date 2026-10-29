import type { Metadata } from "next";
import { AskScreen } from "./AskScreen";

export const metadata: Metadata = { title: "Ask" };

export default function AskPage() {
  return <AskScreen />;
}
