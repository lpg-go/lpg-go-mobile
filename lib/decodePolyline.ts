/**
 * Decodes a Google Maps encoded polyline string into an array of coordinates.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const result: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result_val = 0;
    let byte: number;

    // Decode latitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_val |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = result_val & 1 ? ~(result_val >> 1) : result_val >> 1;
    lat += dLat;

    shift = 0;
    result_val = 0;

    // Decode longitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_val |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = result_val & 1 ? ~(result_val >> 1) : result_val >> 1;
    lng += dLng;

    result.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return result;
}
