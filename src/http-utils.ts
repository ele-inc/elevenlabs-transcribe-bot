/**
 * HTTP utility functions for standardized responses
 */

/**
 * Create a JSON response
 */
export function jsonResponse(
  data: any,
  status: number = 200,
  headers?: HeadersInit
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Create a text response
 */
export function textResponse(
  text: string,
  status: number = 200,
  headers?: HeadersInit
): Response {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain',
      ...headers,
    },
  });
}

/**
 * Create an OK response
 */
export function okResponse(message: string = 'OK'): Response {
  return textResponse(message, 200);
}

/**
 * Create a bad request response
 */
export function badRequest(message: string = 'Bad Request'): Response {
  return jsonResponse({ error: message }, 400);
}

/**
 * Create a not found response
 */
export function notFound(message: string = 'Not Found'): Response {
  return jsonResponse({ error: message }, 404);
}

/**
 * Create a method not allowed response
 */
export function methodNotAllowed(
  allowedMethods: string[] = ['GET', 'POST']
): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      'Allow': allowedMethods.join(', '),
    },
  });
}

/**
 * Create an unauthorized response
 */
export function unauthorized(message: string = 'Unauthorized'): Response {
  return jsonResponse({ error: message }, 401);
}

/**
 * Create a service unavailable response
 */
export function serviceUnavailable(
  message: string = 'Service Unavailable'
): Response {
  return jsonResponse({ error: message }, 503);
}

/**
 * Parse request body safely
 */
export async function parseJsonBody<T = any>(req: Request): Promise<T | null> {
  try {
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return null;
    }
    
    const text = await req.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Validate request method
 */
export function validateMethod(
  req: Request,
  allowedMethods: string[]
): boolean {
  return allowedMethods.includes(req.method.toUpperCase());
}

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice(7);
}

/**
 * Add CORS headers to response
 */
export function withCors(
  response: Response,
  origin: string = '*',
  methods: string[] = ['GET', 'POST', 'OPTIONS']
): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', methods.join(', '));
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}