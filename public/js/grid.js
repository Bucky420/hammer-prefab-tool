export const GRID_VALUES = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
export const EPSILON = 0.000001;
export function roundToGrid(value, grid) { return Number.isFinite(value) && Number.isFinite(grid) && grid > 0 ? Math.round(value / grid) * grid : value; }
export function snapVector(vector, grid) { return { x: roundToGrid(vector.x, grid), y: roundToGrid(vector.y, grid), z: roundToGrid(vector.z, grid) }; }
export function isOnGrid(value, grid) { return Math.abs(value - roundToGrid(value, grid)) <= EPSILON; }
