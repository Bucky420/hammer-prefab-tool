export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export { roundToGrid as snap } from "./grid.js";
export const pointInPolygon=(p,poly)=>poly.reduce((inside,a,i)=>{const b=poly[(i+poly.length-1)%poly.length];return ((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)?!inside:inside},false);
export const distanceToSegment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)};
export const distanceSquared=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy};
