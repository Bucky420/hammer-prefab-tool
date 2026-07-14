import { snap } from "./math.js";
import { roundToGrid } from "./grid.js";
let nextId=1;
export function box(min={x:-64,y:-64,z:0}, max={x:64,y:64,z:128}, material="tools/toolsnodraw") { const v=[[min.x,min.y,min.z],[max.x,min.y,min.z],[max.x,max.y,min.z],[min.x,max.y,min.z],[min.x,min.y,max.z],[max.x,min.y,max.z],[max.x,max.y,max.z],[min.x,max.y,max.z]].map(([x,y,z])=>({x,y,z})); return {id:`brush-${nextId++}`,material,vertices:v,faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]}; }
export function clone(value){return JSON.parse(JSON.stringify(value))}
export function moveVertices(brushes, selected, delta, grid, snapResult = true){ brushes.forEach(b=>b.vertices.forEach((v,i)=>{if(selected.has(`${b.id}:v:${i}`)){v.x=snapResult ? snap(v.x+delta.x,grid) : v.x+delta.x;v.y=snapResult ? snap(v.y+delta.y,grid) : v.y+delta.y;v.z=snapResult ? snap(v.z+delta.z,grid) : v.z+delta.z}})); }
// Matches Hammer's ToolMorph V_rint(position / grid) * grid behavior.
export function snapAllVertices(brushes, grid) { let moved = 0; for (const brush of brushes) for (const vertex of brush.vertices) for (const axis of ["x", "y", "z"]) { const snapped = roundToGrid(vertex[axis], grid); if (vertex[axis] !== snapped) { vertex[axis] = snapped; moved++; } } return moved; }
export function countOffGridCoordinates(brushes, grid) { let total = 0, offGrid = 0; for (const brush of brushes) for (const vertex of brush.vertices) for (const axis of ["x", "y", "z"]) { total++; if (Math.abs(vertex[axis] - Math.round(vertex[axis] / grid) * grid) > .000001) offGrid++; } return { total, offGrid }; }
export function center(b){const n=b.vertices.length;return b.vertices.reduce((a,v)=>({x:a.x+v.x/n,y:a.y+v.y/n,z:a.z+v.z/n}),{x:0,y:0,z:0})}
export function selectedVertexCount(brushes, selection) { return brushes.reduce((count, brush) => count + brush.vertices.reduce((sum, _, index) => sum + (selection.has(`${brush.id}:v:${index}`) ? 1 : 0), 0), 0); }
