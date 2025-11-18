export interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  error?: string;
}

export function logRequest(request: Request): LogEntry {
  const url = new URL(request.url);
  return {
    timestamp: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
  };
}

export function logResponse(entry: LogEntry, statusCode: number, startTime: number): void {
  entry.statusCode = statusCode;
  entry.duration = Date.now() - startTime;
  
  const emoji = statusCode >= 200 && statusCode < 300 ? '✅' : 
                statusCode >= 400 && statusCode < 500 ? '⚠️' : 
                statusCode >= 500 ? '❌' : '📝';
  
  console.log(
    `${emoji} [${entry.timestamp}] ${entry.method} ${entry.path} - ${statusCode} (${entry.duration}ms)`
  );
}