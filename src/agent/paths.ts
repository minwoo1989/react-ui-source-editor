const EDITABLE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

/**
 * Minimal write-guard for the CORS-open localhost agent: the absolute path
 * from the overlay may target any file the OS user can write, so only allow
 * JSX-bearing source extensions.
 * This guard is extension-only and intentionally does NOT constrain directory
 * (it replaces a former PROJECT_ROOT path-confinement check; any writable
 * .tsx/.jsx/.ts/.js is allowed, consistent with the absolute-path contract).
 *
 * Safe for non-string input: returns false immediately for any non-string value,
 * protecting against unvalidated JSON request bodies where `file` may be absent.
 */
export function isEditableSourcePath(file: string): boolean {
  if (typeof file !== "string") return false;
  const lower = file.toLowerCase();
  return EDITABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
