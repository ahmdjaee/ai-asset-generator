import { join } from "node:path";
import { dockerCli, type JobResult, type RunJobOptions, runJob } from "../../../server/runtime/docker.ts";
import { ASSETKIT_DIR, requireRuntimeImage } from "../../../server/runtime/image.ts";
import { createJobDir, type JobDir, removeJobDir } from "../../../server/runtime/job-dir.ts";

export const ENABLED = process.env.RUNTIME_IT === "1";
export const JOBS_ROOT = join(import.meta.dir, "../../../.tmp/jobs-it");
export const SCRIPTS_DIR = join(import.meta.dir, "scripts");
export const IT_OWNER = "it";

let counter = 0;
export function nextJobId(name: string): string {
  counter += 1;
  return `it-${process.pid}-${counter}-${name}`;
}

export const requireImage = requireRuntimeImage;

export type ScriptRun = { result: JobResult; dir: JobDir };

/** Menjalankan skrip di container; folder job dihapus oleh `cleanup`. */
export async function runScript(
  image: string,
  scriptPath: string,
  options: Omit<RunJobOptions, "jobId" | "image" | "mounts" | "owner">,
): Promise<ScriptRun> {
  const dir = await createJobDir(JOBS_ROOT, scriptPath);
  const result = await runJob({
    jobId: nextJobId(
      scriptPath
        .split("/")
        .at(-1)
        ?.replace(/[^a-z0-9]/g, "") ?? "job",
    ),
    image,
    mounts: { jobDir: dir.path, assetkitDir: ASSETKIT_DIR },
    ...options,
    owner: IT_OWNER,
  });
  return { result, dir };
}

export async function cleanup(run: ScriptRun): Promise<void> {
  await removeJobDir(JOBS_ROOT, run.dir);
}

export async function leftoverJobContainers(): Promise<string[]> {
  const listed = await dockerCli(["ps", "-aq", "--filter", "label=aag.job"]);
  return listed.stdout.split("\n").filter((line) => line.trim() !== "");
}
