/**
 * Port lokal. Server dan Vite selalu bind ke 127.0.0.1.
 * Port lain di mesin ini: ai-team 4320/4321; learning-system dan automated-test-app 4330/4331.
 */
export const API_PORT = 4340;
export const WEB_DEV_PORT = 4341;
/** Server E2E (build mode test), terpisah supaya tidak bentrok dengan `bun run dev`. */
export const E2E_PORT = 4342;
