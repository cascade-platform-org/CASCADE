/**
 * xfmv-decode.ts — read an FMV (.xfmv) file's bytes as text for the importer.
 *
 * FMV writes UTF-8, except some versions that write cp1252 under an XML
 * declaration naming no encoding; read as UTF-8, those turn every accented
 * letter into "�". So: strict UTF-8 first, cp1252 when that fails.
 */
export function decodeXfmv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
