import type { Metadata } from "next";
import { Deck } from "@/components/marketing/deck";

export const metadata: Metadata = {
  title: "Cara kerja Redaksi",
};

export default function PresentasiPage() {
  return <Deck />;
}
