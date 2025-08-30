// Cloud Run entry point - wraps the existing Deno.serve handler
import "./index.ts";

// The index.ts already has Deno.serve() which will listen on PORT env variable
// Cloud Run sets PORT environment variable automatically