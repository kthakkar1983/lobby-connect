import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary";
import { initSentry } from "./lib/sentry";
import "./index.css";

initSentry();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
