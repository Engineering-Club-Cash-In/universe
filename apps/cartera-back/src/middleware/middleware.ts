import config from "../config";
import jwt from "jsonwebtoken";

export const validateTokenMiddleware = () => {
  // @ts-ignore
  return async ({ set, headers }) => {
    const authHeader = headers.authorization;

    if (!authHeader) {
      set.status = 401;
      return {
        status: 401,
        message: "Unauthorized: Authorization header not provided",
        success: false,
      }
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      set.status = 401;
      return {
        status: 401,
        message: "Unauthorized: Bearer token not provided",
        success: false,
      }
    }

    headers.payload = { token };

    if (token === config.funtecSecret) {
      return;
    } else if (token === config.funtecSecretRefresh) {
      return;
    } else {
      try {
        jwt.verify(token, config.funtecSecret);
        return;
      } catch (err: any) {
        try {
          jwt.verify(token, config.funtecSecretRefresh);
          return;
        } catch (err2: any) {
          set.status = 401;
          return {
            status: 401,
            message: "Unauthorized: Invalid token",
            success: false,
          }
        }
      }
    }
  };
}