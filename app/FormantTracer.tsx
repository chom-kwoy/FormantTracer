"use client";
import { useRef, useState } from "react";

import { FormantApp } from "@/app/FormantApp";

export default function FormantTracer() {
  const appRef = useRef<FormantApp | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isMale, setIsMale] = useState<boolean>(true);

  const handleClick = () => {
    if (!appRef.current) {
      appRef.current = new FormantApp(isMale);
    }
    try {
      appRef.current.toggle(isRecording, audioFile ?? "kawuy.mp3");
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          alert("Microphone access is required to record audio.");
        } else if (error.name === "NotFoundError") {
          alert("No microphone was found.");
        } else if (error.name === "NotSupportedError") {
          alert("The browser does not support the Web Audio API.");
        } else if (error.name === "SecurityError") {
          alert("The user denied access to the microphone.");
        } else {
          alert("An unknown error occurred.");
        }
      }
    }
  };

  const openFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setAudioFile(file);
      }
    };
    input.click();
  };

  return (
    <div className="bg-gray-100">
      <header className="flex items-center justify-between p-4 bg-blue-500 text-white mb-2">
        <h1 className="text-xl font-bold">Formant Tracer</h1>
      </header>
      <div className="flex justify-center items-center space-x-4 m-1">
        <button
          className={
            (isRecording ? "bg-blue-700" : "bg-blue-500") +
            " hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          }
          onClick={() => {
            setIsRecording(!isRecording);
          }}
        >
          <span className="text-red-500">{isRecording ? "● " : ""}</span>
          Record Mic
        </button>
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={openFile}
        >
          Open File...
        </button>
        <button
          id="startBtn"
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={handleClick}
        >
          Start
        </button>
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => {
            appRef.current?.reset();
          }}
        >
          Reset
        </button>
      </div>
      <div className="text-center text-gray-600 text-sm mb-2">
        {isRecording ? (
          <>Will record from mic when you press Start.</>
        ) : audioFile === null ? (
          <>No file selected. Sample audio file loaded by default.</>
        ) : (
          <>Currently loaded audio file: {audioFile.name}</>
        )}
      </div>
      <div className="flex justify-center items-center space-x-4 m-1">
        <span className="mx-2">Display Settings:</span>
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
