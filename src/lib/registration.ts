export type SupabaseErrorLike = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function registrationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();

  if (error && typeof error === "object") {
    const candidate = error as SupabaseErrorLike;
    const message = nonEmptyString(candidate.message);
    const code = nonEmptyString(candidate.code);
    const details = nonEmptyString(candidate.details);
    const hint = nonEmptyString(candidate.hint);
    const context = [code ? `code ${code}` : null, details, hint].filter(Boolean).join("; ");

    if (message) return context ? `${message} (${context})` : message;
  }

  return "An unexpected database error occurred";
}

export function registrationStageError(stage: string, error: unknown) {
  return new Error(`${stage}: ${registrationErrorMessage(error)}`);
}
