const DEFAULT_SEEDANCE_BASE_URL = "https://ark.cn-beijing.volces.com";

export function normalizeSeedanceBaseUrl(input?: string): string {
  const raw = (input || DEFAULT_SEEDANCE_BASE_URL).trim().replace(/\/+$/, "");

  if (!raw) {
    return `${DEFAULT_SEEDANCE_BASE_URL}/api/v3`;
  }

  if (/\/api\/v3$/i.test(raw)) {
    return raw;
  }
  if (/\/api\/v1$/i.test(raw)) {
    return raw.replace(/\/api\/v1$/i, "/api/v3");
  }
  if (/\/v3$/i.test(raw)) {
    return raw.replace(/\/v3$/i, "/api/v3");
  }
  if (/\/v1$/i.test(raw)) {
    return raw.replace(/\/v1$/i, "/api/v3");
  }
  if (/\/api$/i.test(raw)) {
    return `${raw}/v3`;
  }

  return `${raw}/api/v3`;
}

export function getSeedancePresetModels(): { id: string; name: string }[] {
  const defaultImageModel =
    process.env.SEEDANCE_IMAGE_MODEL || "doubao-seedream-5-0-260128";
  const defaultVideoModel =
    process.env.SEEDANCE_MODEL || "doubao-seedance-1-5-pro-250528";

  return [defaultImageModel, defaultVideoModel]
    .filter((model, index, all) => model && all.indexOf(model) === index)
    .map((model) => ({ id: model, name: model }));
}
