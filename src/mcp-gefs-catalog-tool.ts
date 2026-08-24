import { getGefsCatalog } from "./catalog/gefs-catalog.js";
import { searchGefsCatalog } from "./catalog/gefs-search.js";
import {
  catalogSearchResultSchema,
  type CatalogSearchQueryInput,
} from "./schema/catalog-search.js";

export function handleGetGefsCatalog() {
  const output = getGefsCatalog();
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: { ...output },
  };
}

export function handleSearchGefsCatalog(query: CatalogSearchQueryInput) {
  try {
    const output = catalogSearchResultSchema.parse(searchGefsCatalog(query));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
      structuredContent: { ...output },
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      isError: true as const,
    };
  }
}
