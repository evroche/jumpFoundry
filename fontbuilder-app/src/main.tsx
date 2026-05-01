import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAppConfig } from "./config";
import "./styles.css";

applyAppConfig();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
