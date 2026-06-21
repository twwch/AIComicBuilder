type DiagnosticSeverity = "info" | "warning" | "error";

export interface PipelineDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  fix: string;
}

export function buildPipelineDiagnostic(
  code: string,
  message: string,
  fix: string,
  severity: DiagnosticSeverity = "error",
): PipelineDiagnostic {
  return { code, severity, message, fix };
}

export function diagnosticError(
  code: string,
  message: string,
  fix: string,
  severity: DiagnosticSeverity = "error",
) {
  return {
    error: message,
    diagnostic: buildPipelineDiagnostic(code, message, fix, severity),
  };
}
