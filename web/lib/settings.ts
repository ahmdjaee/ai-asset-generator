/**
 * Pengaturan app (`GET/PUT /api/settings`). Disimpan dari halaman Pengaturan; tab lain mengambil ulang lewat event
 * `settings` di topik `global`. Composer Studio memakai tier bawaan dan budget-nya.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AppSettings, AppSettings as AppSettingsSchema } from "../../shared/settings.ts";
import { api, toApiError } from "./api.ts";

export const settingsKey = ["settings"] as const;

async function fetchSettings(): Promise<AppSettings> {
  const response = await api.settings.$get();
  if (!response.ok) throw await toApiError(response);
  return AppSettingsSchema.parse((await response.json()).settings);
}

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: fetchSettings });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (next: AppSettings) => {
      const response = await api.settings.$put({ json: next });
      if (!response.ok) throw await toApiError(response);
      return AppSettingsSchema.parse((await response.json()).settings);
    },
    onSuccess: (saved) => client.setQueryData(settingsKey, saved),
  });
}
