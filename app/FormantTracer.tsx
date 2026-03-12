"use client";
import { useRef, useState } from "react";

import { FormantApp } from "@/app/FormantApp";

export default function FormantTracer() {
  const appRef = useRef<FormantApp | null>(null);
  const [isMale, setIsMale] = useState<boolean>(true);

  const handleClick = () => {
    if (!appRef.current) {
      appRef.current = new FormantApp(isMale);
    }
    appRef.current.toggle(false, "uytwo.mp3");
  };

  return (
    <div className="bg-gray-100">
      <header className="flex items-center justify-between p-4 bg-blue-500 text-white mb-2">
        <h1 className="text-xl font-bold">Vowel Tracer</h1>
      </header>
      <div className="flex justify-center items-center space-x-4 m-1">
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => {
            setIsMale(!isMale);
            if (appRef.current) {
              appRef.current.setIsMale(!isMale);
            }
          }}
        >
          {isMale ? "Male" : "Female"}
        </button>
        <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
          Open File...
        </button>
        <button
          id="startBtn"
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={handleClick}
        >
          Start
        </button>
      </div>
      <div className="flex flex-col items-center">
        <div>
          <span>
            Formant Space (X=f<sub>2</sub>, Y=f<sub>1</sub>)
          </span>
          <canvas
            id="vowelspace"
            width="640"
            height="480"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrogram</span>
          <canvas
            id="spectrogram2"
            width="640"
            height="240"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrogram (Raw)</span>
          <canvas
            id="spectrogram"
            width="640"
            height="240"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrum (filtered / cepstrum / log spectrum)</span>
          <canvas
            id="spectrum"
            width="640"
            height="480"
            className="border-blue-500 border-2"
          />
        </div>
      </div>
    </div>
  );
}
