import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

function LocalCrashProbe() {
  if (window.location.hostname === "127.0.0.1" && new URLSearchParams(window.location.search).get("forceCrash") === "1") {
    throw new Error("Forced local render crash.");
  }

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LocalCrashProbe />
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
