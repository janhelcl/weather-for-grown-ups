import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "./file-access-policy.js";
import {
  IFS_OPEN_DATA_MIRRORS,
  type IfsHttpAccessPolicy,
} from "../sources/ifs-open-data.js";

export class IfsOpenDataAccessPolicy implements IfsHttpAccessPolicy {
  private readonly cloudPolicy: UpstreamAccessPolicy;
  private readonly directPolicy: UpstreamAccessPolicy;

  constructor(
    stateDir: string,
    cloudPolicy?: UpstreamAccessPolicy,
    directPolicy?: UpstreamAccessPolicy,
  ) {
    this.cloudPolicy = cloudPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfCloud);
    this.directPolicy = directPolicy
      ?? new FileAccessPolicy(stateDir, UPSTREAM_ACCESS_POLICIES.ecmwfDirect);
  }

  run<T>(url: string, operation: () => Promise<T>): Promise<T> {
    return this.policyForUrl(url).run(operation);
  }

  private policyForUrl(url: string): UpstreamAccessPolicy {
    const directBaseUrl = IFS_OPEN_DATA_MIRRORS.find((mirror) => mirror.id === "ecmwf")?.baseUrl;
    return directBaseUrl !== undefined && url.startsWith(directBaseUrl)
      ? this.directPolicy
      : this.cloudPolicy;
  }
}
