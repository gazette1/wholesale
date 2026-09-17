import { env } from "../env";
import { MockPropertyDataProvider } from "./mock";
import { RealEstateApiProvider } from "./realestateapi";
import type { PropertyDataProvider } from "./types";

export * from "./types";
export { MockPropertyDataProvider } from "./mock";
export { RealEstateApiProvider } from "./realestateapi";

let cached: PropertyDataProvider | undefined;

export function propertyDataProvider(): PropertyDataProvider {
  if (cached) return cached;
  const e = env();
  cached = e.PROPERTY_DATA_PROVIDER === "realestateapi" && e.REALESTATEAPI_KEY
    ? new RealEstateApiProvider(e.REALESTATEAPI_KEY, e.REALESTATEAPI_BASE_URL)
    : new MockPropertyDataProvider();
  return cached;
}
