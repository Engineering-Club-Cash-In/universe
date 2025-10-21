import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Amplify } from "aws-amplify";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import awsExports from "./aws-exports";
import { BrowserRouter } from "react-router-dom";

import "@aws-amplify/ui-react/styles.css";

// Configura Amplify con tu backend de Cognito/Rekognition
Amplify.configure(awsExports);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
