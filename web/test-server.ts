/** Server API tiruan untuk tes halaman: rute per tes (`on`), permintaan dicatat untuk diperiksa. */
import { jsonResponse } from "@/test-utils.tsx";

type Handler = (request: Request) => Response | Promise<Response>;

function isHandler(response: Handler | object): response is Handler {
  return typeof response === "function";
}

export type RecordedRequest = Readonly<{ method: string; path: string; request: Request }>;

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  readonly #routes = new Map<string, Handler>();

  /** Rute `METHOD /path`: fungsi penjawab, atau isi JSON yang dijawab dengan status 200. */
  on(method: string, path: string, response: Handler | object): this {
    this.#routes.set(`${method} ${path}`, isHandler(response) ? response : () => jsonResponse(response));
    return this;
  }

  /** Penjawab untuk `mockFetch`. Rute yang tidak didaftarkan dijawab 404 `NOT_FOUND`. */
  readonly fetch = async (path: string, request: Request): Promise<Response> => {
    this.requests.push({ method: request.method, path, request });
    const route = this.#routes.get(`${request.method} ${path}`);
    if (route === undefined) {
      return jsonResponse(
        { code: "NOT_FOUND", message: `Rute uji ${request.method} ${path} tidak ada.` },
        404,
      );
    }
    return route(request);
  };

  /** Permintaan dengan metode dan path ini, urut waktu. */
  calls(method: string, path: string): Request[] {
    return this.requests
      .filter((entry) => entry.method === method && entry.path === path)
      .map((entry) => entry.request);
  }
}
