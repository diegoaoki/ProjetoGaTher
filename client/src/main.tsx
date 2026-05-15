import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TileInspector from "./TileInspector";

// ?inspect=tiles na URL → abre ferramenta de inspeção do tileset
const params = new URLSearchParams(window.location.search);
const inspectMode = params.get("inspect");

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (inspectMode === "tiles") {
  root.render(
    <React.StrictMode>
      <TileInspector />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
