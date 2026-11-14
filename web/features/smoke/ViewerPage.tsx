import { useSearchParams } from "react-router";
import { tSmoke } from "@/i18n/id.ts";
import makhlukFinal from "../../../tests/fixtures/glb/textured/makhluk.glb?url";
import makhlukBase from "../../../tests/fixtures/glb/textured/makhluk-base.glb?url";
import petiFinal from "../../../tests/fixtures/glb/textured/peti.glb?url";
import petiBase from "../../../tests/fixtures/glb/textured/peti-base.glb?url";
import { LazyViewer } from "../viewer/LazyViewer.tsx";
import { sampleDetail } from "./sample-detail.ts";

/** Pasangan bentuk dasar + aset final dari fixture Tahap 4; `rusak` menguji state error (bukan file GLB). */
const MODELS = {
  peti: { name: tSmoke.viewerPage.names.peti, base: petiBase, final: petiFinal },
  makhluk: { name: tSmoke.viewerPage.names.makhluk, base: makhlukBase, final: makhlukFinal },
  rusak: { name: "rusak", base: "/_uji/rusak.glb", final: "/_uji/rusak.glb" },
} as const;

function isModel(key: string): key is keyof typeof MODELS {
  return Object.hasOwn(MODELS, key);
}

/**
 * Halaman uji internal `/_viewer` (mode dev dan tes saja): viewer dengan fixture GLB untuk E2E dan golden.
 * `?model=peti|makhluk|rusak`, `&final=1` aset bertekstur, `&panel=0` tanpa panel Detail.
 */
export function ViewerPage() {
  const [params, setParams] = useSearchParams();
  const key = params.get("model") ?? "peti";
  const final = params.get("final") === "1";
  if (!isModel(key)) {
    return <p className="p-8 text-body text-text-secondary">{tSmoke.viewerPage.unknownModel(key)}</p>;
  }
  const model = MODELS[key];
  const changeVersion = (version: number) => {
    const next = new URLSearchParams(params);
    if (version === 2) next.set("final", "1");
    else next.delete("final");
    setParams(next, { replace: true });
  };
  return (
    <div className="flex min-h-0 flex-1">
      <LazyViewer
        src={final ? model.final : model.base}
        name={model.name}
        stage={final ? "final" : "base"}
        {...(params.get("panel") === "0" ? {} : { detail: sampleDetail(final, changeVersion) })}
      />
    </div>
  );
}
