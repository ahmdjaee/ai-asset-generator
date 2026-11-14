import { harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils.ts";

type RehypePlugins = NonNullable<StreamdownProps["rehypePlugins"]>;

/** Plugin bawaan streamdown yang wajib ada; bila hilang (upgrade), gagal saat dimuat, bukan diam-diam tanpa sanitasi. */
function builtIn(name: "raw" | "sanitize"): RehypePlugins[number] {
  const plugin = defaultRehypePlugins[name];
  if (plugin === undefined) throw new Error(`Plugin rehype bawaan streamdown "${name}" tidak ditemukan.`);
  return plugin;
}

/**
 * Urutan bawaan streamdown (HTML mentah → sanitasi → harden), dengan aturan harden app:
 * - tautan: http/https ke mana saja dan path relatif (`*`), ditambah skema yang selalu dianggap aman oleh harden
 *   (mailto, irc, xmpp, blob, `#anchor`). javascript:, data:, file:, dan vbscript: selalu diblokir dan tampil sebagai
 *   teks biasa. Tautan hanya dibuka bila diklik, di tab baru tanpa referrer; path relatif hanya mencapai rute GET app;
 * - gambar tidak pernah dimuat (tanpa permintaan jaringan dari teks Claude); yang tersisa hanya teks alt-nya.
 * Bawaan streamdown menampilkan penanda berbahasa Inggris dengan warna Tailwind mentah dan memuat gambar remote.
 */
const REHYPE_PLUGINS: RehypePlugins = [
  builtIn("raw"),
  builtIn("sanitize"),
  [
    harden,
    {
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: [],
      allowDataImages: false,
      linkBlockPolicy: "text-only",
      imageBlockPolicy: "text-only",
    },
  ],
];

/**
 * Teks markdown dari Claude (AGENTS §8: streamdown, tanpa `dangerouslySetInnerHTML`). Ukuran teks bawaan Tailwind
 * dibuang (`--text-*: initial`), jadi heading, kode, dan tautan streamdown dipetakan ke text style FigCraft lewat
 * kelas `markdown` di `web/styles/globals.css`. Tombol salin/unduh kode dan tabel dimatikan; tautan dibuka di tab baru
 * tanpa modal konfirmasi streamdown (gayanya tidak memakai token).
 */
export function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string;
  /** Teks masih di-stream: markdown yang belum lengkap (mis. `**tebal` tanpa penutup) tidak dirender mentah. */
  streaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      controls={false}
      linkSafety={{ enabled: false }}
      rehypePlugins={REHYPE_PLUGINS}
      className={cn("markdown text-body text-text-primary", className)}
    >
      {children}
    </Streamdown>
  );
}
