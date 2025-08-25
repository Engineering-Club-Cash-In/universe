import { createServerFn } from '@tanstack/react-start'
import { auth } from '../lib/auth/config'

// Server function to handle authentication
export const handleAuthRequest = createServerFn({
  method: 'POST'
})
  .validator((input: { path: string; method: string; body?: unknown; headers?: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    // Create a Request object for Better Auth
    const request = new Request(`http://localhost:3000${data.path}`, {
      method: data.method,
      headers: {
        'Content-Type': 'application/json',
        ...data.headers
      },
      body: data.body ? JSON.stringify(data.body) : undefined
    })
    
    // Pass to Better Auth handler
    const response = await auth.handler(request)
    
    // Parse response
    const responseData = await response.text()
    let parsedData
    try {
      parsedData = JSON.parse(responseData)
    } catch {
      parsedData = responseData
    }
    
    return {
      data: parsedData,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    }
  })