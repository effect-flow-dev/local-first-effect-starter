// FILE: src/lib/client/logic/tile-math.test.ts
import { describe, it, expect } from "vitest";
import { lon2tile, lat2tile, getSurroundingTiles } from "./tile-math";

describe("Tile Math Logic", () => {
  // Known values for London (approx 51.505, -0.09) at Zoom 13
  // X: 4093, Y: 2724
  const LONDON_LAT = 51.505;
  const LONDON_LON = -0.09;
  const ZOOM = 13;

  it("converts longitude to tile X correctly", () => {
    const x = lon2tile(LONDON_LON, ZOOM);
    // 4093 is the calculated tile X for this location
    expect(x).toBe(4093);
  });

  it("converts latitude to tile Y correctly", () => {
    const y = lat2tile(LONDON_LAT, ZOOM);
    // 2724 is the calculated tile Y
    expect(y).toBe(2724);
  });

  it("generates a 3x3 grid of tile URLs", () => {
    const tiles = getSurroundingTiles(LONDON_LAT, LONDON_LON, ZOOM, 3);
    
    // 3x3 = 9 tiles
    expect(tiles).toHaveLength(9);

    // Check structure of URL
    const regex = /https:\/\/[abc]\.tile\.openstreetmap\.org\/13\/\d+\/\d+\.png/;
    tiles.forEach((url) => {
      expect(url).toMatch(regex);
    });

    // Verify the center tile is present
    // Note: getTileUrl adds random sharding (a,b,c), so we check the path suffix
    const centerSuffix = "/13/4093/2724.png";
    const hasCenter = tiles.some(t => t.endsWith(centerSuffix));
    expect(hasCenter).toBe(true);
  });

  it("handles 5x5 grid", () => {
    const tiles = getSurroundingTiles(0, 0, 10, 5);
    expect(tiles).toHaveLength(25);
  });
});
