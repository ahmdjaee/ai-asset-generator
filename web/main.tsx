import "@fontsource-variable/inter";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("Elemen #root tidak ada di index.html.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
