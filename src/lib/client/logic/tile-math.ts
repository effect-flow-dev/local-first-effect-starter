// FILE: src/lib/client/logic/tile-math.ts

/**
 * Converts a longitude coordinate to a tile X coordinate at a specific zoom level.
 */
export const lon2tile = (lon: number, zoom: number): number => {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
};

/**
 * Converts a latitude coordinate to a tile Y coordinate at a specific zoom level.
 */
export const lat2tile = (lat: number, zoom: number): number => {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom),
  );
};

/**
 * Generates a standard OpenStreetMap tile URL.
 * Includes simple subdomain sharding (a, b, c).
 */
export const getTileUrl = (x: number, y: number, z: number): string => {
  const s = ["a", "b", "c"][Math.floor(Math.random() * 3)];
  return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
};

/**
 * Returns a list of tile URLs covering a square grid around a specific point.
 * @param gridSize The size of the grid (odd number recommended, e.g., 3 for 3x3).
 */
export const getSurroundingTiles = (
  lat: number,
  lon: number,
  zoom: number,
  gridSize = 3,
): string[] => {
  const centerX = lon2tile(lon, zoom);
  const centerY = lat2tile(lat, zoom);
  const tiles: string[] = [];
  const offset = Math.floor(gridSize / 2);

  for (let x = centerX - offset; x <= centerX + offset; x++) {
    for (let y = centerY - offset; y <= centerY + offset; y++) {
      // Ensure positive coordinates (wrap-around logic can be complex, skipping for simplicity)
      if (x >= 0 && y >= 0) {
        tiles.push(getTileUrl(x, y, zoom));
      }
    }
  }
  return tiles;
};

