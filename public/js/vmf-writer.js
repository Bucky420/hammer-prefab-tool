function plane(a, b, c) {
  return `(${a.x} ${a.y} ${a.z}) (${b.x} ${b.y} ${b.z}) (${c.x} ${c.y} ${c.z})`;
}
function vmfAxis(vector, shift, scale, fallback) {
  const axis = vector || fallback;
  return `[${axis[0]} ${axis[1]} ${axis[2]} ${shift ?? 0}] ${scale ?? 0.25}`;
}
export function writeVMF(brushes) {
  let nextId = 2;
  const groupIds = new Map(
    [...new Set(brushes.map((brush) => brush.groupId).filter(Boolean))].map(
      (groupId) => [groupId, nextId++],
    ),
  );
  const solids = brushes
    .map((b) => {
      const solidId = nextId++,
        groupId = groupIds.get(b.groupId);
      return `solid\n{\n\t"id" "${solidId}"\n${b.faces
        .map((f, index) => {
          const axes = b.textureAxes?.[index];
          return `\tside\n\t{\n\t\t"id" "${nextId++}"\n\t\t"plane" "${plane(b.vertices[f[0]], b.vertices[f[1]], b.vertices[f[2]])}"\n\t\t"material" "${b.faceMaterials?.[index] || b.material || "tools/toolsnodraw"}"\n\t\t"uaxis" "${vmfAxis(axes?.u, axes?.uShift, axes?.uScale, [1, 0, 0])}"\n\t\t"vaxis" "${vmfAxis(axes?.v, axes?.vShift, axes?.vScale, [0, -1, 0])}"\n\t\t"rotation" "0"\n\t\t"lightmapscale" "16"\n\t\t"smoothing_groups" "0"\n\t}\n`;
        })
        .join(
          "",
        )}\teditor\n\t{\n\t\t"color" "0 128 255"\n${groupId ? `\t\t"groupid" "${groupId}"\n` : ""}\t}\n}`;
    })
    .join("\n");
  const groups = [...groupIds.values()]
    .map(
      (groupId) =>
        `group\n{\n\t"id" "${groupId}"\n\teditor\n\t{\n\t\t"color" "0 128 255"\n\t}\n}`,
    )
    .join("\n");
  return `versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n${solids}\n${groups}\n}\n`;
}
