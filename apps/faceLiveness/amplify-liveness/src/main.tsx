import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Amplify } from "aws-amplify";
import { BrowserRouter } from "react-router-dom";

import "@aws-amplify/ui-react/styles.css";

const amplifyConfig = {
  Auth: {
    Cognito: {
      identityPoolId: import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID,
      userPoolId: import.meta.env.VITE_AWS_USER_POOLS_ID,
      userPoolClientId: import.meta.env.VITE_AWS_USER_POOLS_WEB_CLIENT_ID,
    },
  },
};

Amplify.configure(amplifyConfig);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
