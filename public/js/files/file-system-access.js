export class FileSystemAccessError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "FileSystemAccessError";
    this.code = options.code || "FILE_SYSTEM_ERROR";
  }
}

export function isFileSystemAbort(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export function supportsFileSystemAccess(environment = globalThis) {
  return Boolean(
    environment &&
    typeof environment.showOpenFilePicker === "function" &&
    typeof environment.showSaveFilePicker === "function",
  );
}

function pickerError(action, error) {
  if (isFileSystemAbort(error)) return null;
  throw new FileSystemAccessError(
    `${action} failed: ${error?.message || error}`,
    {
      code: "PICKER_FAILED",
      cause: error,
    },
  );
}

export async function openFileWithPicker(
  options = {},
  environment = globalThis,
) {
  if (typeof environment?.showOpenFilePicker !== "function")
    throw new FileSystemAccessError(
      "The File System Access open picker is unavailable",
      {
        code: "UNAVAILABLE",
      },
    );
  try {
    const handles = await environment.showOpenFilePicker({
      multiple: false,
      ...options,
    });
    if (!Array.isArray(handles) || handles.length !== 1)
      throw new FileSystemAccessError(
        "The picker must return exactly one file",
        {
          code: "EXACTLY_ONE_FILE",
        },
      );
    const file = await handles[0].getFile();
    return { handle: handles[0], file };
  } catch (error) {
    if (error instanceof FileSystemAccessError) throw error;
    return pickerError("Opening a file", error);
  }
}

export async function writeFileHandle(handle, data, options = {}) {
  if (!handle || typeof handle.createWritable !== "function")
    throw new FileSystemAccessError("A writable file handle is required", {
      code: "INVALID_HANDLE",
    });
  let writable;
  try {
    writable = await handle.createWritable(options.writableOptions);
    await writable.write(data);
    await writable.close();
    return handle;
  } catch (error) {
    if (writable && typeof writable.abort === "function") {
      try {
        await writable.abort();
      } catch {
        // Preserve the original write error.
      }
    }
    if (isFileSystemAbort(error)) return null;
    throw new FileSystemAccessError(
      `Writing the file failed: ${error?.message || error}`,
      {
        code: "WRITE_FAILED",
        cause: error,
      },
    );
  }
}

export async function saveFileWithPicker(
  data,
  options = {},
  environment = globalThis,
) {
  if (typeof environment?.showSaveFilePicker !== "function")
    throw new FileSystemAccessError(
      "The File System Access save picker is unavailable",
      {
        code: "UNAVAILABLE",
      },
    );
  let handle;
  try {
    handle = await environment.showSaveFilePicker(options);
  } catch (error) {
    return pickerError("Choosing a save location", error);
  }
  const written = await writeFileHandle(handle, data, options);
  return written ? { handle: written } : null;
}

export function createFileSystemAccessAdapter(environment = globalThis) {
  return {
    supported: supportsFileSystemAccess(environment),
    open: (options) => openFileWithPicker(options, environment),
    save: (data, options) => saveFileWithPicker(data, options, environment),
    write: writeFileHandle,
  };
}
