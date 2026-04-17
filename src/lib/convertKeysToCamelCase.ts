/* eslint-disable @typescript-eslint/no-explicit-any */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

type AnyObject = Record<string, any>;

function convertKeysToCamelCase<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysToCamelCase(item)) as unknown as T;
  } else if (obj && typeof obj === 'object' && obj.constructor === Object) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = toCamelCase(key);
      result[newKey] = convertKeysToCamelCase(value);
    }
    return result as T;
  }
  return obj;
}

export default convertKeysToCamelCase;
