function formatValue(value: unknown): string {
  return Deno.inspect(value, { depth: Infinity, sorted: true });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) {
    return true;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((value, index) => deepEqual(value, expected[index]))
    );
  }

  if (isPlainObject(actual) && isPlainObject(expected)) {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();

    return (
      deepEqual(actualKeys, expectedKeys) &&
      actualKeys.every((key) => deepEqual(actual[key], expected[key]))
    );
  }

  return false;
}

export function assertEquals<T>(actual: T, expected: T): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `assertEquals failed\nexpected: ${formatValue(expected)}\nactual: ${formatValue(actual)}`,
    );
  }
}

export function assertExists<T>(value: T | null | undefined): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error("assertExists failed: expected value to be defined");
  }
}
