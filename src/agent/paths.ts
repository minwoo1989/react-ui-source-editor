const EDITABLE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

/**
 * Minimal write-guard for the CORS-open localhost agent: the absolute path
 * from the overlay may target any file the OS user can write, so only allow
 * JSX-bearing source extensions.
 */
export function isEditableSourcePath(file: string): boolean {
  const lower = file.toLowerCase();
  return EDITABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
