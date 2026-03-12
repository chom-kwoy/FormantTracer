"use client";
import dynamic from "next/dynamic";

const Formant = dynamic(() => import("./formant"), {
  ssr: false,
  loading: () => <p>Loading...</p>,
});

export default function Home() {
  return <Formant />;
}
