export const invertCoordinates = (coordinates: number[][]): number[][] => {
  const result: number[][] = [];
  for (let i = 0; i < coordinates.length; i++) {
    result.push([coordinates[i][1], coordinates[i][0]]);
  }
  return result;
};

export const getMiddlePoint = (coordinates: number[][]): { latMiddle: number | null; lonMiddle: number | null } => {
  let latMin: number | null = null;
  let latMax: number | null = null;
  let lonMin: number | null = null;
  let lonMax: number | null = null;

  for (let i = 0; i < coordinates.length; i++) {
    if (coordinates[i].length == 2) {
      const lat = coordinates[i][1];
      const lon = coordinates[i][0];

      if (latMin === null || latMin > lat) {
        latMin = lat;
      }
      if (latMax === null || latMax < lat) {
        latMax = lat;
      }
      if (lonMin === null || lonMin > lon) {
        lonMin = lon;
      }
      if (lonMax === null || lonMax < lon) {
        lonMax = lon;
      }
    }
  }
  return {
    latMiddle: latMax !== null && latMin !== null ? (latMax + latMin) / 2 : null,
    lonMiddle: lonMax !== null && lonMin !== null ? (lonMax + lonMin) / 2 : null,
  };
};

const getRadians = (deg: number): number => {
  return (deg / 180.0) * Math.PI;
};

export const getArea = (coordinates: number[][]): number => {
  const cc = invertCoordinates(coordinates);

  const earthRadius = 6378137.0;

  if (cc[0][0] != cc[cc.length - 1][0] || cc[0][1] != cc[cc.length - 1][1]) {
    cc.push([cc[0][0], cc[0][1]]);
  }

  let area = 0;
  if (cc.length > 2) {
    for (let i = 0; i < cc.length - 1; i++) {
      const p1 = cc[i];
      const p2 = cc[i + 1];
      area += getRadians(p2[1] - p1[1]) * (2 + Math.sin(getRadians(p1[0])) + Math.sin(getRadians(p2[0])));
    }

    area = (area * earthRadius * earthRadius) / 2.0;
  }
  return Math.abs(area);
};

export const calcSquareAutoByPolygon = (coordinates: number[][][]): number => {
  let squareAuto = 0.0;
  if (coordinates.length > 0) {
    squareAuto = getArea(coordinates[0]) / 10000.0;
    squareAuto = Math.round(squareAuto * 100.0) / 100.0;
  }
  return squareAuto;
};

export const getCoordinatesWithoutEarthTurnover = (coordinates: number[][]): number[][] => {
  const result: number[][] = [];

  for (let i = 0; i < coordinates.length; i++) {
    if (coordinates[i].length == 2) {
      let lat = coordinates[i][1];
      let lon = coordinates[i][0];

      if (Math.abs(lat) > 90) {
        lat = lat - Math.floor(lat / 360) * 360;
      }
      if (Math.abs(lon) > 180) {
        lon = lon - Math.floor(lon / 360) * 360;
      }

      result.push([lon, lat]);
    }
  }

  return result;
};

export const checkPointInsidePolygon = ({
  lat,
  lon,
  polygon,
}: {
  lat: number;
  lon: number;
  polygon: number[][] | null;
}): boolean => {
  let isInside = false;

  if (polygon !== null) {
    for (let i = 0; i < polygon.length - 1; i++) {
      for (let j = polygon.length - 1; j >= i; j--) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];

        const intersect = yi > lon != yj > lon && lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;
        if (intersect) {
          isInside = !isInside;
        }
      }
    }
  }

  return isInside;
};
