export const ErrorCodes = {
  SERVER_UNAVAILABLE: "SERVER_UNAVAILABLE",
  MISSING_NODE_TYPES: "MISSING_NODE_TYPES",
  MISSING_MODELS: "MISSING_MODELS",
  MISSING_PLUGINS: "MISSING_PLUGINS",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  WORKFLOW_FILE_NOT_FOUND: "WORKFLOW_FILE_NOT_FOUND",
  WORKFLOW_LOAD_FAILED: "WORKFLOW_LOAD_FAILED",
  IMAGE_UPLOAD_FAILED: "IMAGE_UPLOAD_FAILED",
  NO_OUTPUT: "NO_OUTPUT",
  TIMEOUT: "TIMEOUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ComfyUIError {
  code: ErrorCode;
  message: string;
}

export function makeError(code: ErrorCode, message: string): ComfyUIError {
  return { code, message };
}
