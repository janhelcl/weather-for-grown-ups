import type {
  IfsSelectionRequest,
  IfsSelectionSource,
  IfsSubsetFile,
} from "../cache/ifs-open-data-cache.js";

export class IfsEnsMemberSelectionSource implements IfsSelectionSource {
  constructor(
    private readonly source: IfsSelectionSource,
    private readonly number: number,
  ) {}

  fetchSelection(request: IfsSelectionRequest): Promise<IfsSubsetFile> {
    const sharedRunStatic = request.selectors.every((selector) => selector.sourceForecastHour !== undefined);
    if (sharedRunStatic) {
      return this.source.fetchSelection({
        ...request,
        product: "oper-fc",
        selectors: request.selectors.map(({ number: _number, ...selector }) => selector),
      });
    }
    return this.source.fetchSelection({
      ...request,
      product: "enfo-ef",
      selectors: request.selectors.map((selector) => ({
        ...selector,
        number: this.number,
      })),
    });
  }
}
