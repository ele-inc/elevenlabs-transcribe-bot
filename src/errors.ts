/**
 * Centralized error handling utilities
 */

export class AppError extends Error {
  constructor(
    public override message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`${service} error: ${message}`, 'EXTERNAL_SERVICE_ERROR', 503, details);
    this.name = 'ExternalServiceError';
  }
}

export class TranscriptionError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'TRANSCRIPTION_ERROR', 500, details);
    this.name = 'TranscriptionError';
  }
}

/**
 * Centralized error logger
 */
export function logError(error: Error, context?: Record<string, unknown>): void {
  const errorInfo = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error instanceof AppError && {
      code: error.code,
      statusCode: error.statusCode,
      details: error.details,
    }),
    context,
    timestamp: new Date().toISOString(),
  };

  console.error('Error occurred:', JSON.stringify(errorInfo, null, 2));
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error as Error, { context, args });
      throw error;
    }
  }) as T;
}

/**
 * Handle errors and return appropriate HTTP response
 */
export function handleHttpError(error: Error): Response {
  logError(error);

  if (error instanceof AppError) {
    return new Response(
      JSON.stringify({
        error: error.code,
        message: error.message,
        details: error.details,
      }),
      {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Default error response
  return new Response(
    JSON.stringify({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Safe error message for user-facing responses
 */
export function getSafeErrorMessage(error: Error): string {
  if (error instanceof AppError) {
    return error.message;
  }
  
  // Don't expose internal error details to users
  return 'An unexpected error occurred. Please try again later.';
}

/**
 * Retry logic for flaky external services
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on validation or authentication errors
      if (error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }
      
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}