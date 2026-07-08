import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  getProjectAsset,
  listProjectAssets,
  syncImportAssets,
  type ImportAssetDraft,
  type StoryAssetType,
} from "@/lib/story-assets";

function normalizeType(value: string | null): StoryAssetType | undefined {
  if (value === "character" || value === "scene" || value === "prop") return value;
  if (value === "characters") return "character";
  if (value === "scenes" || value === "environments") return "scene";
  if (value === "props" || value === "items") return "prop";
  return undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const type = normalizeType(url.searchParams.get("type"));
  const rows = await listProjectAssets(projectId, type);
  return NextResponse.json({ assets: rows });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    characters?: unknown[];
    items?: unknown[];
    environments?: unknown[];
  };

  const created = await syncImportAssets(projectId, {
    characters: Array.isArray(body.characters) ? body.characters as ImportAssetDraft[] : [],
    items: Array.isArray(body.items) ? body.items as ImportAssetDraft[] : [],
    environments: Array.isArray(body.environments) ? body.environments as ImportAssetDraft[] : [],
  });
  const assets = (await Promise.all(created.map((asset) => getProjectAsset(projectId, asset.id))))
    .filter(Boolean);

  return NextResponse.json({ count: created.length, assets }, { status: 201 });
}
