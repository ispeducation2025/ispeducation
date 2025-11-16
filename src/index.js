// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

/**
 * Safe entry file.
 * - Uses the same behavior as your original file (no automatic BrowserRouter wrapping).
 * - Adds a guard so we log an error if the root element can't be found.
 * - Includes a commented BrowserRouter import/wrapper in case you want routing here.
 */

// If you want routing at the root level, uncomment these two lines and the <BrowserRouter> wrapper below:
// import { BrowserRouter } from "react-router-dom";

const rootEl = document.getElementById("root");

if (!rootEl) {
  console.error("Root element with id 'root' not found. Check your public/index.html");
} else {
  const root = ReactDOM.createRoot(rootEl);

  root.render(
    <React.StrictMode>
      {/* If you want routing at the top-level, uncomment the BrowserRouter import and this wrapper */}
      {/* <BrowserRouter> */}
        <App />
      {/* </BrowserRouter> */}
    </React.StrictMode>
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
