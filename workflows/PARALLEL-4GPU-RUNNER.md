# Four-GPU ComfyUI batch runner

This is a CLI POC for sending the four compiled pet actions to four independent
ComfyUI workers. It does not start or stop cloud instances and it does not read
browser sessions.

## Configuration

Set four different endpoints in a local, ignored environment file or in the
shell process. Never commit the actual endpoints or cookies.

```sh
COMFY_GPU_1_URL=https://gpu-1.example/
COMFY_GPU_2_URL=https://gpu-2.example/
COMFY_GPU_3_URL=https://gpu-3.example/
COMFY_GPU_4_URL=https://gpu-4.example/
```

If a protected endpoint needs a short-lived cookie, use
`COMFY_GPU_N_AUTH_COOKIE`. URL credentials and query-string credentials are
rejected. Cookies are never copied into `run-record.json`.

## First run

Compile and test the complete batch while the paid machines are still off. The
runner never starts a cloud instance; paid machines should only be turned on
after the manifest, four workflow files, hashes, local tests, and media
toolchain are ready.

The accepted six-step preset remains the default. A separate four-step preview
preset can be prepared locally for one controlled speed/quality comparison; it
must not replace the default until its four outputs pass the same QA and visual
identity review:

```sh
npm run pet:workflow -- compile-batch \
  workflows/profiles/orange-longhair-test-v1.json \
  workflows/compiled/batches/orange-longhair-fast-preview-v1 \
  --fast-preview
```

The manifest must contain four compiled, dispatchable branches bound to four
unique slots (`gpu-1` through `gpu-4`). The runner verifies master, driver, and
workflow hashes before spending GPU time.

```sh
npm run pet:batch -- \
  --manifest workflows/compiled/batches/orange-longhair-all-actions-v4/orange_longhair_test_v1-pet-actions-batch-v1.json \
  --run-dir workflows/runs/orange-longhair-parallel-v1
```

Each worker gets the master image and its branch driver. The four branch tasks
are submitted with `Promise.allSettled`; a failure on one worker does not remove
the other three results. Every worker has a concurrency-one queue in the local
runner. Output files are downloaded from every media slot emitted by every
`SaveVideo` node and stored with their real byte-level SHA-256.

Before any GPU request, the runner also resolves a full ffmpeg/ffprobe toolchain
and checks that `blend`, `minterpolate`, `ssim`, and `tpad` are available. Put
the production binaries in the worker image or set `PET_FFMPEG_BIN` and
`PET_FFPROBE_BIN`. A missing media tool is a preflight failure and must never be
discovered after the four paid generations finish.

Downloaded videos are raw results, not published assets. As soon as one branch
downloads, the runner gates its raw first/last frames and all 151 adjacent frame
pairs in both the full frame and subject ROI, rejecting jumps, flashes, and long
freezes before any seam bridge can hide them. It compiles an accepted branch to
H.264 Main Profile Level 3.1/yuv420p with zero B-frames, a maximum 30-frame GOP
and an 8 Mbps VBV cap, at 576x768, 30 fps and 152 frames. Frames 0, 1, 150, and
151 are anchored to the confirmed master. Decode/profile/GOP/timestamp/anchor/
full-cadence SSIM QA must all pass before that one immutable branch file and its
branch record become playable. Post-processing is centrally limited to two
simultaneous jobs because four optical-flow encodes on one CPU made the whole
batch slower. The final batch manifest is `published` only when all four pass;
a rejected batch may retain independently validated sibling branches, while a
failed branch never receives a public URL.

## Resume and retry

Run the same command again to resume branches that already have a `promptId`.
They poll `/history/<promptId>` and `/queue`; they are never POSTed again. A poll
timeout remains `submitted`, so it can be resumed later.

If ComfyUI explicitly reports an execution failure, retry only failed branches:

```sh
npm run pet:batch -- \
  --manifest workflows/compiled/batches/orange-longhair-all-actions-v4/orange_longhair_test_v1-pet-actions-batch-v1.json \
  --run-dir workflows/runs/orange-longhair-parallel-v1 \
  --retry-failed
```

Three successful branches stay untouched. If the response to `POST /prompt` is
lost, the branch becomes `submission_unknown`. The runner intentionally refuses
to retry it, because the original prompt may already be consuming GPU. Reconcile
that prompt in ComfyUI before changing the run record or choosing a new run.

There is one automatic quality retry: if and only if exactly one downloaded
branch fails with `SOURCE_SEAM_MISMATCH`, the runner archives its first output
and reruns that branch with the manifest's second deterministic seed. Two or
more source mismatches trip a batch fuse and spend no retry. The maximum is two
GPU attempts per branch. Retry eligibility lives in `run-record.json`, so a
process restart resumes the same single retry without requiring
`--retry-failed` and without resetting its budget. Encoder, network, toolchain,
or policy errors never trigger a paid seed retry. Passing three branches does
not lower the threshold for the fourth.

The run directory also has an exclusive process lock. This prevents two CLI
processes from reading the same `pending` state and both submitting it. If a
process is force-killed, first confirm no runner is alive and no prompt is being
submitted before manually removing the stale `.pet-batch-run.lock` file.

`--allow-busy-workers` exists for controlled recovery only. The default
preflight rejects unrelated queued prompts, while allowing a prompt id already
owned by the same run record to continue.
