import type { ProfileResult } from "./core/types.js";
import type { ProfileQuery } from "./schema/query.js";

export interface ProfileGetter {
  getProfile(query: ProfileQuery): Promise<ProfileResult>;
}

export async function handleGetGfsProfile(profileService: ProfileGetter, query: ProfileQuery) {
  try {
    const output = await profileService.getProfile(query);
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
