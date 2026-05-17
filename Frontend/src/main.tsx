import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const rootElement = document.getElementById("root")!;

try {
  const router = getRouter();
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  document.getElementById("root-loader")?.remove();
} catch (err) {
  document.getElementById("root-loader")?.remove();
  rootElement.innerHTML = `<div style="font-family:sans-serif;padding:2rem;color:#c00">
    <h2>App failed to start</h2>
    <pre style="white-space:pre-wrap">${err instanceof Error ? err.message : String(err)}</pre>
  </div>`;
}
