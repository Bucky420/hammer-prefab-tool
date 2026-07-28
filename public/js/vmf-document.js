const NUMBER_PATTERN = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi;

let nextImportedId = 50000;

function syntaxError(message, token) {
  const location = token
    ? ` at ${token.line}:${token.column}`
    : " at end of file";
  return new SyntaxError(`VMF parse error${location}: ${message}`);
}

/**
 * Tokenizes Valve's key/value chunk format without treating braces inside
 * quoted values as structure.
 *
 * @param {string} text
 * @returns {Array<{type: "word" | "string" | "brace", value: string, line: number, column: number}>}
 */
export function tokenizeVMF(text) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const character = text[index++];
    if (character === "\n") {
      line++;
      column = 1;
    } else column++;
    return character;
  };

  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      advance();
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") advance();
      continue;
    }
    const start = { line, column };
    if (character === "{" || character === "}") {
      tokens.push({ type: "brace", value: advance(), ...start });
      continue;
    }
    if (character === '"') {
      advance();
      let value = "";
      let closed = false;
      while (index < text.length) {
        const next = advance();
        if (next === '"') {
          closed = true;
          break;
        }
        if (next === "\\" && index < text.length) {
          const escaped = text[index];
          if (escaped === '"' || escaped === "\\") {
            value += advance();
            continue;
          }
        }
        value += next;
      }
      if (!closed) throw syntaxError("unterminated quoted string", start);
      tokens.push({ type: "string", value, ...start });
      continue;
    }
    let value = "";
    while (
      index < text.length &&
      !/\s/.test(text[index]) &&
      text[index] !== "{" &&
      text[index] !== "}" &&
      text[index] !== '"'
    )
      value += advance();
    if (!value)
      throw syntaxError(
        `unexpected character ${JSON.stringify(character)}`,
        start,
      );
    tokens.push({ type: "word", value, ...start });
  }
  return tokens;
}

/**
 * @param {string} text
 * @returns {Array<{name: string, properties: Array<{key: string, value: string}>, children: any[]}>}
 */
export function parseVMFChunks(text) {
  const tokens = tokenizeVMF(text);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  const parseChunk = (nameToken) => {
    const open = take();
    if (!open || open.type !== "brace" || open.value !== "{")
      throw syntaxError(
        `expected "{" after ${JSON.stringify(nameToken.value)}`,
        open || nameToken,
      );
    const chunk = { name: nameToken.value, properties: [], children: [] };
    while (true) {
      const key = take();
      if (!key)
        throw syntaxError(
          `unclosed ${JSON.stringify(chunk.name)} block`,
          nameToken,
        );
      if (key.type === "brace") {
        if (key.value === "}") return chunk;
        throw syntaxError('unexpected "{"', key);
      }
      const value = peek();
      if (!value)
        throw syntaxError(
          `missing value for ${JSON.stringify(key.value)}`,
          key,
        );
      if (value.type === "brace" && value.value === "{") {
        chunk.children.push(parseChunk(key));
        continue;
      }
      if (value.type === "brace")
        throw syntaxError(
          `missing value for ${JSON.stringify(key.value)}`,
          key,
        );
      take();
      chunk.properties.push({ key: key.value, value: value.value });
    }
  };

  const chunks = [];
  while (index < tokens.length) {
    const name = take();
    if (name.type === "brace")
      throw syntaxError(`unexpected ${JSON.stringify(name.value)}`, name);
    chunks.push(parseChunk(name));
  }
  return chunks;
}

function propertiesObject(properties) {
  return Object.fromEntries(properties.map(({ key, value }) => [key, value]));
}

function child(chunk, name) {
  return chunk?.children.find((item) => item.name.toLowerCase() === name);
}

function children(chunk, name) {
  return (
    chunk?.children.filter((item) => item.name.toLowerCase() === name) || []
  );
}

function cloneChunk(chunk) {
  return {
    name: chunk.name,
    properties: chunk.properties.map((property) => ({ ...property })),
    children: chunk.children.map(cloneChunk),
  };
}

function opaqueChildren(chunk, knownNames = []) {
  const known = new Set(knownNames);
  return (chunk?.children || [])
    .filter((item) => !known.has(item.name.toLowerCase()))
    .map(cloneChunk);
}

function parseEditor(editor) {
  if (!editor) return undefined;
  return {
    keys: propertiesObject(editor.properties),
    properties: editor.properties.map((property) => ({ ...property })),
    children: editor.children.map(cloneChunk),
  };
}

function numbers(value) {
  return [...String(value || "").matchAll(NUMBER_PATTERN)].map((match) =>
    Number(match[0]),
  );
}

function parsePlane(value) {
  const values = numbers(value);
  return values.length === 9
    ? [
        { x: values[0], y: values[1], z: values[2] },
        { x: values[3], y: values[4], z: values[5] },
        { x: values[6], y: values[7], z: values[8] },
      ]
    : null;
}

function parseAxis(value) {
  const values = numbers(value);
  return values.length === 5
    ? { vector: values.slice(0, 3), shift: values[3], scale: values[4] }
    : null;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function planeEquation(points) {
  const normal = cross(
    subtract(points[1], points[0]),
    subtract(points[2], points[0]),
  );
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 1e-9) return null;
  const unit = {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length,
  };
  return { normal: unit, distance: dot(unit, points[0]), points };
}

function intersectPlanes(first, second, third) {
  const bc = cross(second.normal, third.normal);
  const ca = cross(third.normal, first.normal);
  const ab = cross(first.normal, second.normal);
  const denominator = dot(first.normal, bc);
  if (Math.abs(denominator) < 1e-8) return null;
  return {
    x:
      (bc.x * first.distance + ca.x * second.distance + ab.x * third.distance) /
      denominator,
    y:
      (bc.y * first.distance + ca.y * second.distance + ab.y * third.distance) /
      denominator,
    z:
      (bc.z * first.distance + ca.z * second.distance + ab.z * third.distance) /
      denominator,
  };
}

function solidVertices(planes) {
  const vertices = [];
  for (let first = 0; first < planes.length - 2; first++)
    for (let second = first + 1; second < planes.length - 1; second++)
      for (let third = second + 1; third < planes.length; third++) {
        const point = intersectPlanes(
          planes[first],
          planes[second],
          planes[third],
        );
        if (
          !point ||
          ![point.x, point.y, point.z].every(Number.isFinite) ||
          planes.some(
            (plane) => dot(plane.normal, point) < plane.distance - 0.02,
          )
        )
          continue;
        if (
          !vertices.some(
            (vertex) =>
              Math.abs(vertex.x - point.x) < 0.00001 &&
              Math.abs(vertex.y - point.y) < 0.00001 &&
              Math.abs(vertex.z - point.z) < 0.00001,
          )
        )
          vertices.push(point);
      }
  if (vertices.length >= 4) return vertices;
  for (const plane of planes)
    for (const point of plane.points)
      if (
        planes.every(
          (candidate) =>
            dot(candidate.normal, point) >= candidate.distance - 0.02,
        ) &&
        !vertices.some(
          (vertex) =>
            Math.abs(vertex.x - point.x) < 0.00001 &&
            Math.abs(vertex.y - point.y) < 0.00001 &&
            Math.abs(vertex.z - point.z) < 0.00001,
        )
      )
        vertices.push({ ...point });
  return vertices;
}

function faceVertices(plane, vertices) {
  const points = vertices
    .map((vertex, index) => ({ vertex, index }))
    .filter(
      ({ vertex }) =>
        Math.abs(dot(plane.normal, vertex) - plane.distance) < 0.02,
    );
  if (points.length < 3) return [];
  const center = points.reduce(
    (sum, { vertex }) => ({
      x: sum.x + vertex.x / points.length,
      y: sum.y + vertex.y / points.length,
      z: sum.z + vertex.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const reference =
    Math.abs(plane.normal.z) < 0.9
      ? { x: 0, y: 0, z: 1 }
      : { x: 1, y: 0, z: 0 };
  const uRaw = cross(plane.normal, reference);
  const uLength = Math.hypot(uRaw.x, uRaw.y, uRaw.z) || 1;
  const u = { x: uRaw.x / uLength, y: uRaw.y / uLength, z: uRaw.z / uLength };
  const v = cross(plane.normal, u);
  const face = points
    .sort(
      (left, right) =>
        Math.atan2(
          dot(subtract(left.vertex, center), v),
          dot(subtract(left.vertex, center), u),
        ) -
        Math.atan2(
          dot(subtract(right.vertex, center), v),
          dot(subtract(right.vertex, center), u),
        ),
    )
    .map(({ index }) => index);
  const outward = cross(
    subtract(vertices[face[1]], vertices[face[0]]),
    subtract(vertices[face[2]], vertices[face[0]]),
  );
  return dot(outward, plane.normal) > 0 ? face.reverse() : face;
}

function numericOrValue(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseSolid(solid, ownership = {}) {
  const solidKeys = propertiesObject(solid.properties);
  const editor = child(solid, "editor");
  const editorKeys = propertiesObject(editor?.properties || []);
  const parsedSides = children(solid, "side")
    .map((side) => {
      const keys = propertiesObject(side.properties);
      const points = parsePlane(keys.plane);
      const equation = points && planeEquation(points);
      return equation
        ? {
            equation,
            keys,
            properties: side.properties.map((property) => ({ ...property })),
            children: side.children.map(cloneChunk),
            u: parseAxis(keys.uaxis),
            v: parseAxis(keys.vaxis),
          }
        : null;
    })
    .filter(Boolean);
  const vertices = solidVertices(parsedSides.map(({ equation }) => equation));
  const faceRecords = parsedSides
    .map((side) => ({ ...side, face: faceVertices(side.equation, vertices) }))
    .filter(({ face }) => face.length >= 3);
  if (parsedSides.length !== children(solid, "side").length)
    throw syntaxError(
      `solid ${solidKeys.id || "(unknown)"} contains an invalid side plane`,
      null,
    );
  if (vertices.length < 4 || faceRecords.length < 4)
    throw syntaxError(
      `solid ${solidKeys.id || "(unknown)"} does not form a closed convex brush`,
      null,
    );
  const hammerGroupId = editorKeys.groupid;
  const hammerEntityId = ownership.entityId;
  return {
    id: `imported-${nextImportedId++}`,
    vmfId: solidKeys.id,
    material: faceRecords[0]?.keys.material || "tools/toolsnodraw",
    faceMaterials: faceRecords.map(
      ({ keys }) => keys.material || "tools/toolsnodraw",
    ),
    textureAxes: faceRecords.map(({ u, v }) =>
      u && v
        ? {
            u: u.vector,
            v: v.vector,
            uShift: u.shift,
            vShift: v.shift,
            uScale: u.scale,
            vScale: v.scale,
          }
        : undefined,
    ),
    sideData: faceRecords.map(({ keys, properties, children }) => ({
      id: keys.id,
      rotation: numericOrValue(keys.rotation, 0),
      lightmapScale: numericOrValue(keys.lightmapscale, 16),
      smoothingGroups: numericOrValue(keys.smoothing_groups, 0),
      properties,
      children,
    })),
    vertices,
    faces: faceRecords.map(({ face }) => face),
    groupId: hammerGroupId ? `vmf-group-${hammerGroupId}` : undefined,
    hammerGroupId,
    entityId: hammerEntityId ? `vmf-entity-${hammerEntityId}` : undefined,
    hammerEntityId,
    entityClassname: ownership.entityClassname,
    vmfKeys: solidKeys,
    vmfProperties: solid.properties.map((property) => ({ ...property })),
    children: opaqueChildren(solid, ["side", "editor"]),
    editor: parseEditor(editor),
  };
}

function parseGroup(group) {
  const keys = propertiesObject(group.properties);
  const editor = child(group, "editor");
  const editorKeys = propertiesObject(editor?.properties || []);
  return {
    id: keys.id,
    keys,
    properties: group.properties.map((property) => ({ ...property })),
    groupId: editorKeys.groupid ? `vmf-group-${editorKeys.groupid}` : undefined,
    hammerGroupId: editorKeys.groupid,
    children: opaqueChildren(group, ["editor"]),
    editor: parseEditor(editor),
  };
}

/**
 * Parses a VMF into a JSON-serializable project document while retaining the
 * editor ownership and side fields needed for a lossless geometry export.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseVMFDocument(text) {
  const chunks = parseVMFChunks(text);
  const versionChunk = chunks.find(
    (chunk) => chunk.name.toLowerCase() === "versioninfo",
  );
  const worldChunk = chunks.find(
    (chunk) => chunk.name.toLowerCase() === "world",
  );
  if (!worldChunk) throw syntaxError("missing world block", null);
  const worldKeys = propertiesObject(worldChunk.properties);
  const worldBrushes = children(worldChunk, "solid").map((solid) =>
    parseSolid(solid),
  );
  const groups = children(worldChunk, "group").map(parseGroup);
  const entities = chunks
    .filter((chunk) => chunk.name.toLowerCase() === "entity")
    .map((entity) => {
      const keys = propertiesObject(entity.properties);
      const editor = child(entity, "editor");
      const brushes = children(entity, "solid").map((solid) =>
        parseSolid(solid, {
          entityId: keys.id,
          entityClassname: keys.classname,
        }),
      );
      return {
        id: keys.id,
        classname: keys.classname,
        keys,
        properties: entity.properties.map((property) => ({ ...property })),
        brushes,
        children: opaqueChildren(entity, ["solid", "editor"]),
        editor: parseEditor(editor),
      };
    });
  return {
    format: "hammer-prefab-tool-vmf-document",
    version: 1,
    versionInfo: versionChunk ? propertiesObject(versionChunk.properties) : {},
    versionProperties:
      versionChunk?.properties.map((property) => ({ ...property })) || [],
    versionChildren: versionChunk?.children.map(cloneChunk) || [],
    world: {
      id: worldKeys.id,
      keys: worldKeys,
      properties: worldChunk.properties.map((property) => ({ ...property })),
      brushes: worldBrushes,
      groups,
      children: opaqueChildren(worldChunk, ["solid", "group"]),
    },
    entities,
    groups,
    brushes: [...worldBrushes, ...entities.flatMap((entity) => entity.brushes)],
    children: chunks
      .filter(
        (chunk) =>
          !["versioninfo", "world", "entity"].includes(
            chunk.name.toLowerCase(),
          ),
      )
      .map(cloneChunk),
  };
}
