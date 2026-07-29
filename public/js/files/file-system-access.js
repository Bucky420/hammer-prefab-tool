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

export function canUseFileSystemAccess(environment = globalThis) {
  return Boolean(
    environment &&
    environment.self === environment.top &&
    environment.isSecureContext &&
    typeof environment.showOpenFilePicker === "function",
  );
}

export function supportsFileSystemAccess(environment = globalThis) {
  return Boolean(
    canUseFileSystemAccess(environment) &&
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
  if (!canUseFileSystemAccess(environment))
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

export async function openVmfWithInput(environment = globalThis) {
  return new Promise((resolve, reject) => {
    const documentObject = environment.document;
    const input = documentObject.createElement("input");
    input.type = "file";
    input.accept = ".vmf,text/plain";
    input.hidden = true;
    const cleanup = () => input.remove();
    input.addEventListener(
      "change",
      async () => {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          reject(new DOMException("No file selected", "AbortError"));
          return;
        }
        try {
          resolve({
            name: file.name,
            contents: await file.text(),
            handle: null,
            directSaveSupported: false,
          });
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        cleanup();
        reject(new DOMException("File selection cancelled", "AbortError"));
      },
      { once: true },
    );
    documentObject.body.appendChild(input);
    input.click();
  });
}

export async function openVmfFile(environment = globalThis) {
  if (canUseFileSystemAccess(environment)) {
    try {
      const [handle] = await environment.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Valve Map File",
            accept: { "text/plain": [".vmf"] },
          },
        ],
      });
      const file = await handle.getFile();
      return {
        name: file.name,
        contents: await file.text(),
        handle,
        directSaveSupported: true,
      };
    } catch (error) {
      if (isFileSystemAbort(error)) throw error;
    }
  }
  return openVmfWithInput(environment);
}

export async function writeFileHandle(handle, data, options = {}) {
  if (!handle || typeof handle.createWritable !== "function")
    throw new FileSystemAccessError("A writable file handle is required", {
      code: "INVALID_HANDLE",
    });
  let writable;
  try {
    if (
      typeof handle.queryPermission === "function" &&
      typeof handle.requestPermission === "function"
    ) {
      const permissionOptions = { mode: "readwrite" };
      let permission = await handle.queryPermission(permissionOptions);
      if (permission !== "granted")
        permission = await handle.requestPermission(permissionOptions);
      if (permission !== "granted")
        throw new FileSystemAccessError(
          "Write permission was not granted for this file",
          { code: "PERMISSION_DENIED" },
        );
    }
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
    if (error instanceof FileSystemAccessError) throw error;
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

export async function saveVmfFile(
  { contents, handle = null, filename = "prefab.vmf" },
  environment = globalThis,
) {
  if (handle) {
    await writeFileHandle(handle, contents);
    return { mode: "direct", filename };
  }
  const blob = new environment.Blob([contents], {
    type: "text/plain;charset=utf-8",
  });
  const url = environment.URL.createObjectURL(blob);
  const link = environment.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  environment.document.body.appendChild(link);
  link.click();
  link.remove();
  environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000);
  return { mode: "download", filename };
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
