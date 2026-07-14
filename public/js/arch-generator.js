import { generateRing } from "./ring-generator.js";
export const generateArch = options => generateRing({ startAngle: 0, endAngle: 180, ...options });
