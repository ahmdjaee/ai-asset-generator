/**
 * Data Studio dari server: detail aset (TanStack Query, kunci `["asset", id]`), halaman event thread, dan aksi
 * pemilik. Cache disegarkan lewat event WebSocket (`useAssetThread`, `useAssetWatcher`), tanpa polling.
 */
import { type QueryClient, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toApiError } from "@/lib/api.ts";
import { assetsKey } from "@/lib/assets.ts";
import type { AssetStateEvent } from "../../../shared/asset-events.ts";
import type { TierId } from "../../../shared/limits.ts";
import type { EventsPage } from "./thread-store.ts";

export const assetKey = (assetId: string) => ["asset", assetId] as const;

async function fetchDetail(assetId: string) {
  const response = await api.assets[":id"].$get({ param: { id: assetId } });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

export type AssetDetailData = Awaited<ReturnType<typeof fetchDetail>>;
export type AssetData = AssetDetailData["asset"];
export type VersionData = AssetDetailData["versions"][number];
export type AttachmentData = AssetDetailData["attachments"][number];

/**
 * Tanda aset sudah dihapus (event `deleted` di topik global, atau dihapus dari tab ini), disimpan di cache query.
 * Detailnya tidak diambil lagi, karena permintaan itu pasti 404; halaman yang masih menampilkan aset beralih ke state
 * "dihapus". Kuncinya terpisah dari `["asset", id]`, jadi invalidasi detail tidak menyentuhnya.
 */
const deletedKey = (assetId: string) => ["asset-deleted", assetId] as const;

export function markAssetDeleted(client: QueryClient, assetId: string): void {
  client.setQueryData(deletedKey(assetId), true);
}

export function useAssetDeleted(assetId: string): boolean {
  const { data } = useQuery({ queryKey: deletedKey(assetId), queryFn: skipToken, initialData: false });
  return data === true;
}

export function useAssetDetail(assetId: string) {
  const deleted = useAssetDeleted(assetId);
  return useQuery({
    queryKey: assetKey(assetId),
    queryFn: deleted ? skipToken : () => fetchDetail(assetId),
  });
}

export async function fetchEvents(
  assetId: string,
  query: Readonly<{ before?: number; limit?: number }>,
): Promise<EventsPage> {
  const response = await api.assets[":id"].events.$get({
    param: { id: assetId },
    query: {
      ...(query.before === undefined ? {} : { before: String(query.before) }),
      ...(query.limit === undefined ? {} : { limit: String(query.limit) }),
    },
  });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

/**
 * Jumlah event `state` yang sudah digabung, per client dan aset. Setiap perubahan status juga dikirim sebagai event
 * state, jadi event yang masuk selama permintaan aksi berjalan sama baru atau lebih baru daripada respons aksinya
 * (mode palsu bisa menyelesaikan tahap sebelum respons approve diproses).
 */
const stateRevisions = new WeakMap<QueryClient, Map<string, number>>();

function stateRevision(client: QueryClient, assetId: string): number {
  return stateRevisions.get(client)?.get(assetId) ?? 0;
}

function bumpStateRevision(client: QueryClient, assetId: string): void {
  const revisions = stateRevisions.get(client) ?? new Map<string, number>();
  revisions.set(assetId, stateRevision(client, assetId) + 1);
  stateRevisions.set(client, revisions);
}

/** Event `state` dari thread langsung digabung ke detail di cache (tanpa menunggu refetch). */
export function mergeStateEvent(client: QueryClient, assetId: string, event: AssetStateEvent): void {
  bumpStateRevision(client, assetId);
  client.setQueryData<AssetDetailData>(assetKey(assetId), (current) =>
    current === undefined
      ? current
      : {
          ...current,
          asset: {
            ...current.asset,
            status: event.status,
            runState: event.runState,
            lastError: event.lastError,
            approvedBaseVersion: event.approvedBaseVersion,
            currentVersion: event.currentVersion,
            buildsLeft: event.buildsLeft,
          },
        },
  );
}

export type CreateAssetInput = Readonly<{ prompt: string; tierId: TierId; files: readonly File[] }>;

export function useCreateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssetInput) => {
      const response = await api.assets.$post({
        form: { prompt: input.prompt, tierId: input.tierId, "files[]": [...input.files] },
      });
      if (!response.ok) throw await toApiError(response);
      return (await response.json()).asset;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: assetsKey }),
  });
}

export type AssetAction =
  | Readonly<{ type: "message"; text: string; files: readonly File[] }>
  | Readonly<{ type: "answer"; questionId: string; answers: AnswerPayload }>
  | Readonly<{ type: "approve" }>
  | Readonly<{ type: "finish" }>
  | Readonly<{ type: "change_shape"; text: string }>
  | Readonly<{ type: "stop" }>;

export type AnswerPayload = Readonly<
  Record<string, Readonly<{ selected: readonly string[]; other?: string }>>
>;

async function runAction(assetId: string, action: AssetAction) {
  const param = { id: assetId };
  const assets = api.assets[":id"];
  switch (action.type) {
    case "message":
      return assets.messages.$post({ param, form: { text: action.text, "files[]": [...action.files] } });
    case "answer":
      return assets.answers[":questionId"].$post({
        param: { ...param, questionId: action.questionId },
        json: {
          answers: Object.fromEntries(
            Object.entries(action.answers).map(([question, choice]) => [
              question,
              {
                selected: [...choice.selected],
                ...(choice.other === undefined ? {} : { other: choice.other }),
              },
            ]),
          ),
        },
      });
    case "approve":
      return assets.approve.$post({ param, json: {} });
    case "finish":
      return assets.finish.$post({ param });
    case "change_shape":
      return assets["change-shape"].$post({ param, json: { text: action.text } });
    case "stop":
      return assets.stop.$post({ param });
  }
}

/**
 * Aksi pemilik pada satu aset. Respons berisi aset terbaru dan langsung ditulis ke cache detail, kecuali bila event
 * state masuk lebih dulu selama permintaan berjalan: event itu tidak lebih lama daripada respons, jadi respons
 * dilewati supaya dock tidak mundur.
 */
export function useAssetAction(assetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: AssetAction) => {
      const response = await runAction(assetId, action);
      if (!response.ok) throw await toApiError(response);
      return (await response.json()).asset;
    },
    onMutate: () => ({ revision: stateRevision(client, assetId) }),
    onSuccess: (asset, _action, started) => {
      if (started.revision === stateRevision(client, assetId)) {
        client.setQueryData<AssetDetailData>(assetKey(assetId), (current) =>
          current === undefined ? current : { ...current, asset },
        );
      }
      void client.invalidateQueries({ queryKey: assetsKey });
    },
  });
}
