import { describe, expect, test } from "bun:test";
import { BASE_JOB_LIMITS, TEXTURED_JOB_LIMITS } from "../../shared/limits.ts";
import {
  buildRunArgs,
  containerName,
  ownerForDataDir,
  parseProtocolLine,
  type RunSpec,
  RuntimeError,
  TailBuffer,
} from "./docker.ts";

const spec: RunSpec = {
  jobId: "job-1",
  image: "asset-forge:0123456789ab",
  mounts: {
    jobDir: "/data/jobs/job-1",
    refsDir: "/data/assets/a1/refs",
    assetkitDir: "/repo/runtime/assetkit",
  },
  limits: BASE_JOB_LIMITS,
  user: "1000:1000",
  owner: "d-0123456789ab",
  command: ["python", "-m", "assetkit.run", "/job/script.py"],
};

describe("buildRunArgs", () => {
  test("flag sandbox tidak berubah diam-diam", () => {
    expect(buildRunArgs(spec)).toMatchSnapshot();
  });

  test("flag wajib ada dan memori = memori + swap", () => {
    const args = buildRunArgs(spec).join(" ");
    for (const flag of [
      "--network none",
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      `--pids-limit ${BASE_JOB_LIMITS.pids}`,
      `--memory ${BASE_JOB_LIMITS.memoryBytes} --memory-swap ${BASE_JOB_LIMITS.memoryBytes}`,
      "--label aag.job=job-1 --label aag.owner=d-0123456789ab",
      "--name aag-job-job-1",
      "--user 1000:1000",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain("--rm");
    expect(args).not.toContain("--privileged");
  });

  test("job bertekstur: pustaka material read-only di /materials + env AAG_MATERIALS (snapshot)", () => {
    const args = buildRunArgs({
      ...spec,
      limits: TEXTURED_JOB_LIMITS,
      mounts: { ...spec.mounts, materialsDir: "/data/library/materials" },
    });
    expect(args).toMatchSnapshot();
    expect(args.join(" ")).toContain(
      "--mount type=bind,source=/data/library/materials,target=/materials,readonly",
    );
    expect(args.join(" ")).toContain("--env AAG_MATERIALS=/materials");
  });

  test("tanpa materialsDir tidak ada mount /materials", () => {
    expect(buildRunArgs(spec).join(" ")).not.toContain("/materials");
  });

  test("materialsDir dengan koma ditolak", () => {
    expect(() =>
      buildRunArgs({ ...spec, mounts: { ...spec.mounts, materialsDir: "/x,target=/job" } }),
    ).toThrow(RuntimeError);
  });

  test("tanpa refsDir tidak ada mount /refs", () => {
    const args = buildRunArgs({ ...spec, mounts: { jobDir: "/j", assetkitDir: "/a" } });
    expect(args.join(" ")).not.toContain("/refs");
  });

  test("/refs dan /opt/assetkit read-only, /job tidak", () => {
    const mounts = buildRunArgs(spec).filter((arg) => arg.startsWith("type=bind"));
    expect(mounts).toEqual([
      "type=bind,source=/data/jobs/job-1,target=/job",
      "type=bind,source=/data/assets/a1/refs,target=/refs,readonly",
      "type=bind,source=/repo/runtime/assetkit,target=/opt/assetkit,readonly",
    ]);
  });

  test.each(["", "Job", "-job", "a".repeat(64), "job_1", "job;rm", "../x"])(
    "jobId tidak valid ditolak: %p",
    (jobId) => {
      expect(() => buildRunArgs({ ...spec, jobId })).toThrow(RuntimeError);
    },
  );

  test.each([
    ["path relatif", { jobDir: "jobs/1", assetkitDir: "/a" }],
    ["koma menyelipkan opsi mount", { jobDir: "/j,readonly=false", assetkitDir: "/a" }],
    ["newline", { jobDir: "/j", assetkitDir: "/a\n" }],
    ["refsDir relatif", { jobDir: "/j", assetkitDir: "/a", refsDir: "refs" }],
  ])("mount tidak valid ditolak: %s", (_label, mounts) => {
    expect(() => buildRunArgs({ ...spec, mounts })).toThrow(RuntimeError);
  });

  test.each(["root", "0", "1000", "1000:1000:1"])("user harus uid:gid: %p", (user) => {
    expect(() => buildRunArgs({ ...spec, user })).toThrow(RuntimeError);
  });

  test.each(["", "D-1", "a b", "x=y"])("owner tidak valid ditolak: %p", (owner) => {
    expect(() => buildRunArgs({ ...spec, owner })).toThrow(RuntimeError);
  });

  test("owner dari DATA_DIR: stabil dan berbeda per folder", () => {
    expect(ownerForDataDir("/var/data")).toMatch(/^d-[0-9a-f]{12}$/);
    expect(ownerForDataDir("/var/data")).toBe(ownerForDataDir("/var/data/"));
    expect(ownerForDataDir("/var/data")).not.toBe(ownerForDataDir("/tmp/e2e/data"));
  });

  test("nama container dari jobId", () => {
    expect(containerName("abc")).toBe("aag-job-abc");
  });
});

describe("parseProtocolLine", () => {
  test("event progres valid", () => {
    expect(parseProtocolLine('@@aag {"type":"progress","step":"badan","pct":40}')).toEqual({
      type: "progress",
      step: "badan",
      pct: 40,
    });
  });

  test("event memori valid", () => {
    expect(parseProtocolLine('@@aag {"type":"memory","peakBytes":1024}')).toEqual({
      type: "memory",
      peakBytes: 1024,
    });
  });

  test.each([
    "print biasa",
    "@@aag bukan json",
    '@@aag {"type":"progress","step":"x","pct":101}',
    '@@aag {"type":"progress","step":"","pct":1}',
    '@@aag {"type":"memory","peakBytes":-1}',
    '@@aag {"type":"shell","cmd":"rm"}',
    ` @@aag {"type":"progress","step":"x","pct":1}`,
    `@@aag {"type":"progress","step":"${"x".repeat(5000)}","pct":1}`,
  ])("baris lain atau tidak valid → null: %#", (line) => {
    expect(parseProtocolLine(line)).toBeNull();
  });
});

describe("TailBuffer", () => {
  test("menyimpan seluruh teks yang masih di bawah batas", () => {
    const tail = new TailBuffer(10);
    tail.append("abc");
    tail.append("def");
    expect(tail.toString()).toBe("abcdef");
  });

  test("hanya menyimpan bagian akhir", () => {
    const tail = new TailBuffer(4);
    for (const chunk of ["0123", "4567", "89", "AB"]) tail.append(chunk);
    expect(tail.toString()).toBe("89AB");
  });
});
