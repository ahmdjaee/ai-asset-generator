/**
 * Tipe minimal untuk `gltf-validator` (paket resmi Khronos, tanpa tipe bawaan).
 * Hanya bagian yang dipakai; diperluas bila perlu. Acuan: node_modules/gltf-validator/README.md.
 */
declare module "gltf-validator" {
  export type ValidationMessage = {
    code: string;
    message: string;
    /** 0 = error, 1 = warning, 2 = info, 3 = hint */
    severity: 0 | 1 | 2 | 3;
    pointer?: string;
    offset?: number;
  };

  export type ValidationReport = {
    uri?: string;
    mimeType?: string;
    validatorVersion: string;
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      numHints: number;
      messages: ValidationMessage[];
      truncated: boolean;
    };
    info?: Record<string, unknown>;
  };

  export type ValidationOptions = {
    uri?: string;
    format?: "glb" | "gltf";
    maxIssues?: number;
    writeTimestamp?: boolean;
    ignoredIssues?: string[];
    onlyIssues?: string[];
    severityOverrides?: Record<string, 0 | 1 | 2 | 3>;
    externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  };

  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<ValidationReport>;
  export function validateString(json: string, options?: ValidationOptions): Promise<ValidationReport>;
  export function version(): string;
  export function supportedExtensions(): string[];
}
