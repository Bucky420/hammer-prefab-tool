export class LocalServerFileError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "LocalServerFileError";
    this.code = options.code || "LOCAL_SERVER_ERROR";
    this.operation = options.operation;
  }
}

export function createLocalServerFileAdapter(api) {
  if (!api || typeof api !== "object")
    throw new LocalServerFileError("An API implementation must be injected", {
      code: "API_REQUIRED",
    });
  const call = async (operation, method, ...args) => {
    if (typeof api[method] !== "function")
      throw new LocalServerFileError(
        `Injected API does not implement ${method}()`,
        {
          code: "METHOD_UNAVAILABLE",
          operation,
        },
      );
    try {
      return await api[method](...args);
    } catch (error) {
      throw new LocalServerFileError(
        `${operation} failed: ${error?.message || error}`,
        { operation, cause: error },
      );
    }
  };
  const adapter = {
    listProjects: () => call("Listing projects", "projects"),
    listFiles: (kind) => call("Listing files", "files", kind),
    loadProject: (path, kind = "project") =>
      call("Loading a project", "load", path, kind),
    saveProject: (path, project) =>
      call("Saving a project", "save", path, project),
    autosaveProject: (path, project) =>
      call("Autosaving a project", "autosave", path, project),
    openVmf: (path, kind = "import") =>
      call("Opening a VMF", "openVMF", path, kind),
    saveVmf: (path, vmf) => call("Saving a VMF", "exportVMF", path, vmf),
  };
  adapter.openVMF = adapter.openVmf;
  adapter.exportVMF = adapter.saveVmf;
  return Object.freeze(adapter);
}
