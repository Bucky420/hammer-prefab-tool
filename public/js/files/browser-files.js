import { parseProject, PROJECT_EXTENSION } from "../project-format.js";

export const FILE_KINDS = Object.freeze({
  PROJECT: "project",
  VMF: "vmf",
  UNKNOWN: "unknown",
});

export class BrowserFileError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "BrowserFileError";
    this.code = options.code || "FILE_ERROR";
  }
}

export function classifyFile(fileOrName) {
  const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name;
  if (typeof name !== "string" || !name.trim())
    throw new BrowserFileError("File must have a name", {
      code: "INVALID_FILE",
    });
  const lower = name.toLowerCase();
  if (lower.endsWith(PROJECT_EXTENSION))
    return {
      kind: FILE_KINDS.PROJECT,
      name,
      extension: PROJECT_EXTENSION,
      legacy: false,
    };
  if (lower.endsWith(".json"))
    return { kind: FILE_KINDS.PROJECT, name, extension: ".json", legacy: true };
  if (lower.endsWith(".vmf"))
    return { kind: FILE_KINDS.VMF, name, extension: ".vmf", legacy: false };
  return { kind: FILE_KINDS.UNKNOWN, name, extension: "", legacy: false };
}

export function classifySingleFile(files, options = {}) {
  const list = Array.from(files ?? []);
  if (list.length !== 1)
    throw new BrowserFileError(
      `Select exactly one file; received ${list.length}`,
      { code: "EXACTLY_ONE_FILE" },
    );
  const classification = classifyFile(list[0]);
  const allowedKinds = options.allowedKinds ?? [
    FILE_KINDS.PROJECT,
    FILE_KINDS.VMF,
  ];
  if (!allowedKinds.includes(classification.kind))
    throw new BrowserFileError(
      `Unsupported file type: ${classification.name}`,
      {
        code: "UNSUPPORTED_FILE_TYPE",
      },
    );
  return { file: list[0], ...classification };
}

async function readText(file, FileReaderClass) {
  if (typeof file?.text === "function") return file.text();
  if (!FileReaderClass)
    throw new BrowserFileError("This browser cannot read the selected file", {
      code: "FILE_READER_UNAVAILABLE",
    });
  return new Promise((resolve, reject) => {
    const reader = new FileReaderClass();
    reader.onerror = () =>
      reject(
        new BrowserFileError(`Could not read ${file.name}`, {
          code: "READ_FAILED",
          cause: reader.error,
        }),
      );
    reader.onabort = () =>
      reject(
        new BrowserFileError(`Reading ${file.name} was cancelled`, {
          code: "ABORTED",
        }),
      );
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export async function readSingleBrowserFile(files, options = {}) {
  const classified = classifySingleFile(files, options);
  try {
    const text = await readText(
      classified.file,
      options.FileReader ?? globalThis.FileReader,
    );
    return { ...classified, text };
  } catch (error) {
    if (error instanceof BrowserFileError) throw error;
    throw new BrowserFileError(
      `Could not read ${classified.name}: ${error.message}`,
      {
        code: "READ_FAILED",
        cause: error,
      },
    );
  }
}

export async function readProjectBrowserFile(files, options = {}) {
  const result = await readSingleBrowserFile(files, {
    ...options,
    allowedKinds: [FILE_KINDS.PROJECT],
  });
  return {
    ...result,
    project: parseProject(result.text, { name: result.name }),
  };
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeFilename(name, fallback = "untitled") {
  let safe = String(name ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/g, "")
    .replace(/[. ]+$/g, "");
  if (!safe || safe === "." || safe === "..") safe = fallback;
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;
  return safe.slice(0, 240) || fallback;
}

export function ensureExtension(name, extension) {
  const normalized = extension.startsWith(".") ? extension : `.${extension}`;
  const safe = sanitizeFilename(name);
  return safe.toLowerCase().endsWith(normalized.toLowerCase())
    ? safe
    : `${safe}${normalized}`;
}

export function projectFilename(name) {
  let safe = sanitizeFilename(name, "untitled");
  if (safe.toLowerCase().endsWith(PROJECT_EXTENSION)) return safe;
  if (safe.toLowerCase().endsWith(".json")) safe = safe.slice(0, -5);
  return ensureExtension(safe, PROJECT_EXTENSION);
}

export function vmfFilename(name) {
  return ensureExtension(name, ".vmf");
}

export function triggerBlobDownload(blob, filename, dependencies = {}) {
  const documentObject = dependencies.document ?? globalThis.document;
  const urlObject = dependencies.URL ?? globalThis.URL;
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout;
  if (
    !documentObject?.createElement ||
    !urlObject?.createObjectURL ||
    !urlObject?.revokeObjectURL
  )
    throw new BrowserFileError("Blob downloads are not supported", {
      code: "DOWNLOAD_UNAVAILABLE",
    });
  const url = urlObject.createObjectURL(blob);
  try {
    const link = documentObject.createElement("a");
    link.href = url;
    link.download = sanitizeFilename(filename);
    link.style && (link.style.display = "none");
    documentObject.body?.append?.(link);
    link.click();
    link.remove?.();
  } catch (error) {
    urlObject.revokeObjectURL(url);
    throw new BrowserFileError(
      `Download could not be started: ${error.message}`,
      {
        code: "DOWNLOAD_FAILED",
        cause: error,
      },
    );
  }
  schedule(() => urlObject.revokeObjectURL(url), 0);
  return { filename: sanitizeFilename(filename), url };
}

export function downloadText(text, filename, options = {}) {
  const BlobClass = options.Blob ?? globalThis.Blob;
  if (!BlobClass)
    throw new BrowserFileError("Blob downloads are not supported", {
      code: "DOWNLOAD_UNAVAILABLE",
    });
  const blob = new BlobClass([String(text)], {
    type: options.type || "application/json;charset=utf-8",
  });
  return triggerBlobDownload(blob, filename, options);
}
