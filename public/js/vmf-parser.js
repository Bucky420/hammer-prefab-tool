import { parseVMFDocument as parseDocument } from "./vmf-document.js";

/**
 * Compatibility API used by the editor. Entity-owned solids remain included,
 * matching the previous parser's all-solids behavior.
 *
 * @param {string} text
 * @returns {import("./geometry-model.js").Brush[]}
 */
export function parseVMF(text) {
  return parseDocument(text).brushes;
}

export { parseDocument as parseVMFDocument };
