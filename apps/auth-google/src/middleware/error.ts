import { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class ApiError extends Error implements AppError {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: Error | HTTPException, c: Context) => {
  console.error(`[Error] ${err.message}`);
  
  if (process.env.NODE_ENV === "development") {
    console.error(err.stack);
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: {
          message: err.message,
          ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
        },
      },
      err.status
    );
  }

  const statusCode = (err as AppError).statusCode || 500;
  const message = err.message || "Internal Server Error";

  return c.json(
    {
      success: false,
      error: {
        message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
      },
    },
    statusCode as any
  );
};

export const notFoundHandler = (c: Context) => {
  return c.json(
    {
      success: false,
      error: {
        message: `Route ${c.req.path} not found`,
        code: "NOT_FOUND",
      },
    },
    404
  );
};
