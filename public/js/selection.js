import { pointInPolygon, distanceToSegment, distanceSquared } from "./math.js";
export function selectByShape(points, shape, mode){
  if (mode === "box") { const minX = Math.min(shape.x, shape.x + shape.w), maxX = Math.max(shape.x, shape.x + shape.w), minY = Math.min(shape.y, shape.y + shape.h), maxY = Math.max(shape.y, shape.y + shape.h); return points.filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY); }
  if (mode === "circle") return points.filter(p => distanceSquared(p, shape) <= shape.r * shape.r);
  return points.filter(p => pointInPolygon(p, shape));
}
export function applySelection(current, ids, operation = "replace") { const next = new Set(operation === "replace" ? [] : current); ids.forEach(id => { if (operation === "remove") next.delete(id); else if (operation === "toggle") next.has(id) ? next.delete(id) : next.add(id); else next.add(id); }); return next; }
export function ringVertexIds(brushes, role) { return brushes.flatMap(brush => (brush.vertexRoles?.[role] || []).map(index => `${brush.id}:v:${index}`)); }
export function nearest(points,p,max=12){let result=null,best=max;points.forEach(x=>{const d=Math.hypot(x.x-p.x,x.y-p.y);if(d<best){best=d;result=x}});return result;}
export { distanceToSegment };
