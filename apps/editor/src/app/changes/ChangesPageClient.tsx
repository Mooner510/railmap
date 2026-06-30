"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input, Textarea } from "@repo/ui/input";
import { Panel } from "@repo/ui/panel";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ManualOverlayBundle } from "../editorModel";

const CATEGORIES = [
  {
    key: "stationOverrides",
    label: "역 보정",
    description: "역 표시명, 위치, 메모 override",
  },
  {
    key: "manualTransferGroups",
    label: "환승 그룹",
    description: "editor에서 만든 수동 환승 그룹",
  },
  {
    key: "nonTransferStationIds",
    label: "미환승역",
    description: "환승 그룹 대상에서 제외한 역 ID",
  },
  {
    key: "branchStationExclusions",
    label: "노선별 역 제외",
    description: "특정 노선에서 제거한 역 override",
  },
  {
    key: "lineBranchOverrides",
    label: "지선 overlay",
    description: "역 추가/노선 결합 지선 override",
  },
  {
    key: "geometryOverrides",
    label: "선형 보정",
    description: "일반 노선 수동 선형 보정",
  },
  {
    key: "branchOverrides",
    label: "노선 보정",
    description: "노선 표시명/메모 override",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];
type SnapshotSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  createdAt: string;
  fileName: string;
};

type EditorState = {
  editingKey: string | null;
  draft: string;
};

function getItemId(value: unknown, index: number) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["id", "stationId", "branchId"]) {
      const id = record[key];
      if (typeof id === "string" && id.trim()) return id;
    }
  }
  return `item-${index + 1}`;
}

function describeItem(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "unknown";
  const record = value as Record<string, unknown>;
  const parts = [
    record.nameKo,
    record.stationId,
    record.branchId,
    record.parentBranchId,
    record.anchorStationId,
    record.mode,
  ].filter(
    (part): part is string =>
      typeof part === "string" && part.trim().length > 0,
  );
  return parts.slice(0, 3).join(" · ") || JSON.stringify(value).slice(0, 80);
}

function categoryItems(overlays: ManualOverlayBundle | null, key: CategoryKey) {
  if (!overlays) return [] as unknown[];
  const value = overlays[key];
  return Array.isArray(value) ? value : [];
}

function replaceCategoryItem(
  overlays: ManualOverlayBundle,
  key: CategoryKey,
  index: number,
  value: unknown,
): ManualOverlayBundle {
  const items = [...categoryItems(overlays, key)];
  items[index] = value;
  return { ...overlays, [key]: items } as ManualOverlayBundle;
}

function deleteCategoryItem(
  overlays: ManualOverlayBundle,
  key: CategoryKey,
  index: number,
): ManualOverlayBundle {
  const items = categoryItems(overlays, key).filter(
    (_, itemIndex) => itemIndex !== index,
  );
  return { ...overlays, [key]: items } as ManualOverlayBundle;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export default function ChangesPageClient() {
  const [overlays, setOverlays] = useState<ManualOverlayBundle | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryKey>("stationOverrides");
  const [editor, setEditor] = useState<EditorState>({
    editingKey: null,
    draft: "",
  });
  const [snapshotSubtitle, setSnapshotSubtitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [nextOverlays, nextSnapshots] = await Promise.all([
      fetchJson<ManualOverlayBundle>("/api/manual-overlays"),
      fetchJson<SnapshotSummary[]>("/api/manual-overlays/snapshots"),
    ]);
    setOverlays(nextOverlays);
    setSnapshots(nextSnapshots);
  }

  useEffect(() => {
    void reload().catch((error) =>
      setMessage(error instanceof Error ? error.message : "로드 실패"),
    );
  }, []);

  const selectedItems = useMemo(
    () => categoryItems(overlays, selectedCategory),
    [overlays, selectedCategory],
  );

  const totalCount = useMemo(
    () =>
      CATEGORIES.reduce(
        (sum, category) => sum + categoryItems(overlays, category.key).length,
        0,
      ),
    [overlays],
  );

  async function saveOverlays(next: ManualOverlayBundle, doneMessage: string) {
    setBusy(true);
    try {
      const saved = await fetchJson<ManualOverlayBundle>(
        "/api/manual-overlays",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        },
      );
      setOverlays(saved);
      setEditor({ editingKey: null, draft: "" });
      setMessage(doneMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(index: number) {
    if (!overlays) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.draft);
    } catch {
      setMessage("JSON 형식이 올바르지 않습니다");
      return;
    }
    await saveOverlays(
      replaceCategoryItem(overlays, selectedCategory, index, parsed),
      "수정 내용을 저장했습니다",
    );
  }

  async function deleteItem(index: number) {
    if (!overlays) return;
    if (!window.confirm("이 override 항목을 삭제할까요?")) return;
    await saveOverlays(
      deleteCategoryItem(overlays, selectedCategory, index),
      "항목을 삭제했습니다",
    );
  }

  async function createSnapshot() {
    setBusy(true);
    try {
      await fetchJson<SnapshotSummary>("/api/manual-overlays/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subtitle: snapshotSubtitle }),
      });
      setSnapshotSubtitle("");
      await reload();
      setMessage("스냅샷을 저장했습니다");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "스냅샷 저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function loadSnapshot(snapshotId: string) {
    if (
      !window.confirm(
        "현재 메인 데이터를 '메인 스냅샷'으로 저장한 뒤 이 스냅샷을 불러올까요?",
      )
    )
      return;
    setBusy(true);
    try {
      await fetchJson<{ overlays: ManualOverlayBundle }>(
        "/api/manual-overlays/snapshots",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "load", snapshotId }),
        },
      );
      await reload();
      setMessage("스냅샷을 메인 데이터로 불러왔습니다");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "스냅샷 불러오기 실패",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-8 text-slate-950">
      <section className="mx-auto grid max-w-7xl gap-3">
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <Badge>Manual Overrides</Badge>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                전체 변경 내용
              </h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                editor에서 저장한 override 데이터만 종류별로 조회하고, 항목
                단위로 수정/삭제합니다.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/">메인</Link>
              </Button>
              <Button asChild>
                <Link href="/editor">통합 맵 에디터</Link>
              </Button>
            </div>
          </div>
        </Panel>

        <div className="grid gap-3 lg:grid-cols-[260px_1fr_340px]">
          <Panel>
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm font-semibold">카테고리</strong>
                <Badge>{totalCount}개</Badge>
              </div>
              <div className="grid gap-1">
                {CATEGORIES.map((category) => {
                  const count = categoryItems(overlays, category.key).length;
                  return (
                    <button
                      key={category.key}
                      type="button"
                      className={`rounded-2xl px-3 py-2 text-left text-xs font-semibold ${
                        selectedCategory === category.key
                          ? "bg-blue-600 text-white"
                          : "bg-slate-50 text-slate-600 hover:bg-blue-50"
                      }`}
                      onClick={() => {
                        setSelectedCategory(category.key);
                        setEditor({ editingKey: null, draft: "" });
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{category.label}</span>
                        <span>{count}</span>
                      </span>
                      <span className="mt-1 block text-[10px] opacity-70">
                        {category.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.03em]">
                    {
                      CATEGORIES.find(
                        (category) => category.key === selectedCategory,
                      )?.label
                    }
                  </h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    항목을 수정한 뒤 저장하면 즉시 manual overlay 파일에
                    반영됩니다.
                  </p>
                </div>
                <Badge>{selectedItems.length}개</Badge>
              </div>

              <div className="mt-4 grid gap-3">
                {selectedItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-medium text-slate-500">
                    저장된 override가 없습니다.
                  </div>
                ) : null}
                {selectedItems.map((item, index) => {
                  const itemKey = `${selectedCategory}:${index}:${getItemId(item, index)}`;
                  const editing = editor.editingKey === itemKey;
                  return (
                    <div
                      key={itemKey}
                      className="rounded-2xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="block truncate text-sm font-semibold text-slate-800">
                            {describeItem(item)}
                          </strong>
                          <p className="mt-1 text-[11px] font-medium text-slate-400">
                            {getItemId(item, index)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setEditor({
                                editingKey: itemKey,
                                draft: JSON.stringify(item, null, 2),
                              })
                            }
                          >
                            수정
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void deleteItem(index)}
                          >
                            삭제
                          </Button>
                        </div>
                      </div>
                      {editing ? (
                        <div className="mt-3 grid gap-2">
                          <Textarea
                            className="min-h-64 font-mono text-xs"
                            value={editor.draft}
                            onChange={(event) =>
                              setEditor({
                                ...editor,
                                draft: event.target.value,
                              })
                            }
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                setEditor({ editingKey: null, draft: "" })
                              }
                            >
                              취소
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => void saveItem(index)}
                            >
                              저장
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                          {JSON.stringify(item, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="grid gap-3 p-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em]">
                  스냅샷
                </h2>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                  스냅샷은 프로젝트 내부 data/manual/snapshots에 저장됩니다.
                  별도 export/import는 제공하지 않습니다.
                </p>
              </div>
              <Input
                placeholder="부제목 선택 입력"
                value={snapshotSubtitle}
                onChange={(event) => setSnapshotSubtitle(event.target.value)}
              />
              <Button disabled={busy} onClick={() => void createSnapshot()}>
                현재 메인 데이터 스냅샷 저장
              </Button>
              <div className="max-h-[560px] overflow-y-auto rounded-2xl border border-slate-200 p-2">
                {snapshots.length === 0 ? (
                  <p className="p-3 text-xs font-medium text-slate-400">
                    저장된 스냅샷이 없습니다.
                  </p>
                ) : null}
                {snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="rounded-xl p-2 hover:bg-slate-50"
                  >
                    <strong className="block text-xs font-semibold text-slate-700">
                      {snapshot.title}
                    </strong>
                    <p className="mt-1 text-[10px] font-medium text-slate-400">
                      {snapshot.fileName}
                    </p>
                    <Button
                      className="mt-2 w-full"

                      variant="outline"
                      disabled={busy}
                      onClick={() => void loadSnapshot(snapshot.id)}
                    >
                      불러오기
                    </Button>
                  </div>
                ))}
              </div>
              {message ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-700">
                  {message}
                </div>
              ) : null}
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}
