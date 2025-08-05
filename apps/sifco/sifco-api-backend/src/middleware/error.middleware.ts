export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(error: Error | AppError) {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  
  const response = {
    success: false,
    error: {
      message: error.message,
      code,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  };

  console.error(`[${new Date().toISOString()}] Error:`, error);

  return new Response(JSON.stringify(response), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}