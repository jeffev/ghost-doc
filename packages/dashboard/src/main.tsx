import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("Root element #root not found");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
