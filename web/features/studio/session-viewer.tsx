import { type ComponentType, createContext, useContext } from "react";
import { LazyViewer } from "../viewer/LazyViewer.tsx";
import type { ViewerProps } from "../viewer/Viewer.tsx";

/**
 * Viewer di halaman sesi. Bawaannya viewer 3D lazy. Tes halaman memasang viewer tiruan tanpa three.js, sehingga tidak
 * bergantung pada chunk viewer; perilaku viewer sungguhan diuji di tes viewer dan E2E.
 */
export const SessionViewerContext = createContext<ComponentType<ViewerProps>>(LazyViewer);

export function useSessionViewer(): ComponentType<ViewerProps> {
  return useContext(SessionViewerContext);
}
