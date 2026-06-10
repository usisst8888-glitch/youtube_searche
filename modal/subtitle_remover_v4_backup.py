"""
Subtitle Remover — Modal Serverless GPU Pipeline (v3 clean plate caching)

v2 → v3 변경:
- scaledown_window 60 → 0 (처리 끝나면 즉시 종료 → idle 비용 0)
- Pass 2를 clean plate 캐싱으로 갈아엎음:
  · 영상 길이에 따라 N개 키프레임 선택 (1초당 최대 1개, 최대 8개)
  · 각 키프레임에서만 LaMa 호출 → "clean plate"로 캐시
  · 나머지 프레임은 가장 가까운 clean plate를 alpha 블렌딩으로 paste
  → 4초 영상: LaMa 116번 → 4번 (29배 ↓)
  → 60초 영상: LaMa 1800번 → 8번 (225배 ↓)
- Pass 1 OCR sampling 5 → max(15, fps) (1초마다, OCR 시간도 절감)
"""

import modal

app = modal.App("subtitle-remover")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install(
        "ffmpeg",
        "libgl1",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender1",
    )
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        "simple-lama-inpainting==0.1.2",
        "easyocr==1.7.1",
        "opencv-python==4.8.1.78",
        "numpy<2",
        "pillow",
        "tqdm",
        "fastapi",
    )
    .run_commands(
        'python -c "from simple_lama_inpainting import SimpleLama; SimpleLama()"',
        'python -c "import easyocr; easyocr.Reader([\\"ch_sim\\",\\"en\\"], gpu=False, verbose=False)"',
    )
)


@app.cls(
    image=image,
    gpu="T4",
    timeout=900,
    cpu=4.0,
    memory=8192,
    scaledown_window=2,
)
class SubtitleRemover:
    @modal.enter()
    def load_models(self):
        import easyocr
        from simple_lama_inpainting import SimpleLama

        print("[init] Loading EasyOCR + LaMa to GPU...")
        self.reader = easyocr.Reader(["ch_sim", "en"], gpu=True, verbose=False)
        self.lama = SimpleLama()
        print("[init] Models ready")

    @modal.method()
    def process(self, video_url: str) -> bytes:
        import json
        import shutil
        import subprocess
        import tempfile
        import urllib.request
        from pathlib import Path

        import cv2
        import numpy as np
        from PIL import Image

        workdir = Path(tempfile.mkdtemp(prefix="subtitle_"))
        in_raw = workdir / "in_raw.mp4"
        in_720 = workdir / "in_720.mp4"
        out_clean = workdir / "out_clean.mp4"
        out_final = workdir / "out_final.mp4"

        try:
            print(f"[1/6] Download: {video_url}")
            urllib.request.urlretrieve(video_url, str(in_raw))

            print("[2/6] Downscale to 720p (short side)")
            subprocess.run(
                [
                    "ffmpeg", "-i", str(in_raw),
                    "-vf",
                    "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
                    "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
                    "-c:a", "copy",
                    "-y", str(in_720),
                ],
                check=True, capture_output=True,
            )

            probe = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries",
                    "stream=width,height,r_frame_rate:format=duration",
                    "-of", "json",
                    str(in_720),
                ],
                capture_output=True, text=True, check=True,
            )
            meta = json.loads(probe.stdout)
            width = int(meta["streams"][0]["width"])
            height = int(meta["streams"][0]["height"])
            rfr = meta["streams"][0]["r_frame_rate"].split("/")
            fps = float(rfr[0]) / float(rfr[1])
            duration = float(meta["format"]["duration"])

            cap_meta = cv2.VideoCapture(str(in_720))
            total_frames = int(cap_meta.get(cv2.CAP_PROP_FRAME_COUNT))
            cap_meta.release()
            print(
                f"  720p: {width}x{height} @ {fps:.2f}fps, {duration:.1f}s, "
                f"{total_frames} frames"
            )

            # Pass 1 — 1초마다 OCR로 마스크 union
            ocr_step = max(15, int(round(fps)))
            print(f"[3/6] Pass 1: OCR every {ocr_step} frames → union mask")
            union_mask = np.zeros((height, width), dtype=np.uint8)
            cap = cv2.VideoCapture(str(in_720))
            sampled = 0
            for idx in range(total_frames):
                ret, img = cap.read()
                if not ret:
                    break
                if idx % ocr_step != 0:
                    continue
                sampled += 1
                try:
                    horiz_list, free_list = self.reader.detect(img)
                except Exception as e:
                    print(f"  OCR err frame {idx}: {e}")
                    continue

                if horiz_list and len(horiz_list) > 0:
                    for box in horiz_list[0] or []:
                        if not box or len(box) < 4:
                            continue
                        x1, x2, y1, y2 = box
                        x1, y1 = max(0, int(x1)), max(0, int(y1))
                        x2, y2 = min(width, int(x2)), min(height, int(y2))
                        if (x2 - x1) > 10 and (y2 - y1) > 10:
                            union_mask[y1:y2, x1:x2] = 255
                if free_list and len(free_list) > 0:
                    for pts in free_list[0] or []:
                        if not pts:
                            continue
                        arr = np.array(pts, dtype=np.float32)
                        x1, y1 = int(arr[:, 0].min()), int(arr[:, 1].min())
                        x2, y2 = int(arr[:, 0].max()), int(arr[:, 1].max())
                        x1, y1 = max(0, x1), max(0, y1)
                        x2, y2 = min(width, x2), min(height, y2)
                        if (x2 - x1) > 10 and (y2 - y1) > 10:
                            union_mask[y1:y2, x1:x2] = 255
            cap.release()
            coverage = int(union_mask.sum() // 255)
            print(f"  sampled={sampled}, mask coverage={coverage}px")

            if coverage == 0:
                print("  no text → return downscaled original")
                return in_720.read_bytes()

            # dilate 10px
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
            union_mask = cv2.dilate(union_mask, kernel, iterations=1)

            # 마스크 bbox + 패딩
            ys, xs = np.where(union_mask > 127)
            y1m, y2m = int(ys.min()), int(ys.max()) + 1
            x1m, x2m = int(xs.min()), int(xs.max()) + 1
            pad = 80
            cy1, cy2 = max(0, y1m - pad), min(height, y2m + pad)
            cx1, cx2 = max(0, x1m - pad), min(width, x2m + pad)
            print(
                f"  inpaint crop: ({cx1},{cy1})~({cx2},{cy2}) "
                f"= {cx2 - cx1}x{cy2 - cy1}"
            )

            mask_crop = union_mask[cy1:cy2, cx1:cx2]
            mask_pil = Image.fromarray(mask_crop)
            mask_feather = cv2.GaussianBlur(mask_crop, (21, 21), 0)
            alpha = (mask_feather.astype(np.float32) / 255.0)[:, :, None]

            # Pass 2-a — clean plate 생성 (LaMa 호출 N번만)
            # 1초당 2개 키프레임, 최소 2개, 최대 24개
            n_keyframes = min(24, max(2, int(round(duration * 2))))
            if n_keyframes == 1:
                keyframe_indices = [0]
            else:
                step = (total_frames - 1) / (n_keyframes - 1)
                keyframe_indices = sorted(
                    {int(round(i * step)) for i in range(n_keyframes)}
                )
            print(
                f"[4/6] Pass 2a: build clean plates at {len(keyframe_indices)} "
                f"keyframes (LaMa calls)"
            )
            clean_plates: dict[int, np.ndarray] = {}
            cap = cv2.VideoCapture(str(in_720))
            for k_idx in keyframe_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, k_idx)
                ret, img = cap.read()
                if not ret:
                    continue
                img_crop = img[cy1:cy2, cx1:cx2]
                img_rgb = cv2.cvtColor(img_crop, cv2.COLOR_BGR2RGB)
                img_pil = Image.fromarray(img_rgb)
                try:
                    cleaned_pil = self.lama(img_pil, mask_pil)
                    cleaned_rgb = np.array(cleaned_pil)
                    ch, cw = img_crop.shape[:2]
                    if cleaned_rgb.shape[:2] != (ch, cw):
                        cleaned_rgb = cleaned_rgb[:ch, :cw]
                    clean_plates[k_idx] = cv2.cvtColor(
                        cleaned_rgb, cv2.COLOR_RGB2BGR
                    )
                    print(f"  ✓ keyframe {k_idx}")
                except Exception as e:
                    print(f"  ✗ keyframe {k_idx}: {e}")
            cap.release()

            if not clean_plates:
                print("  no clean plate generated → return downscaled original")
                return in_720.read_bytes()

            sorted_keys = sorted(clean_plates.keys())
            plate_f32 = {k: v.astype(np.float32) for k, v in clean_plates.items()}

            def get_plate(idx: int) -> np.ndarray:
                # 두 인접 키프레임 사이 linear interpolation
                if len(sorted_keys) == 1 or idx <= sorted_keys[0]:
                    return clean_plates[sorted_keys[0]]
                if idx >= sorted_keys[-1]:
                    return clean_plates[sorted_keys[-1]]
                for i in range(len(sorted_keys) - 1):
                    a, b = sorted_keys[i], sorted_keys[i + 1]
                    if a <= idx <= b:
                        t = (idx - a) / (b - a)
                        blended = plate_f32[a] * (1 - t) + plate_f32[b] * t
                        return blended.astype(np.uint8)
                return clean_plates[sorted_keys[0]]

            # Pass 2-b — 모든 프레임에 paste + 인코딩
            print("[5/6] Pass 2b: paste + encode (raw → libx264)")
            encoder = subprocess.Popen(
                [
                    "ffmpeg", "-y",
                    "-f", "rawvideo", "-vcodec", "rawvideo",
                    "-s", f"{width}x{height}",
                    "-pix_fmt", "bgr24",
                    "-r", f"{fps:.6f}",
                    "-i", "-",
                    "-c:v", "libx264", "-crf", "21", "-preset", "veryfast",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    str(out_clean),
                ],
                stdin=subprocess.PIPE, stderr=subprocess.PIPE,
            )

            cap = cv2.VideoCapture(str(in_720))
            for idx in range(total_frames):
                ret, img = cap.read()
                if not ret:
                    break
                plate = get_plate(idx)
                img_crop = img[cy1:cy2, cx1:cx2]
                blended = img_crop * (1 - alpha) + plate * alpha
                img[cy1:cy2, cx1:cx2] = blended.astype(np.uint8)
                encoder.stdin.write(img.tobytes())
                if idx % 200 == 0:
                    print(f"  paste {idx}/{total_frames}")
            cap.release()
            encoder.stdin.close()
            encoder.wait()

            print("[6/6] Mux original audio")
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", str(out_clean),
                    "-i", str(in_720),
                    "-c:v", "copy",
                    "-c:a", "copy",
                    "-map", "0:v:0",
                    "-map", "1:a:0?",
                    "-shortest",
                    "-movflags", "+faststart",
                    str(out_final),
                ],
                check=True, capture_output=True,
            )

            result_bytes = out_final.read_bytes()
            print(f"Done: {len(result_bytes) / 1024 / 1024:.1f}MB")
            return result_bytes

        finally:
            shutil.rmtree(workdir, ignore_errors=True)


# ── HTTP Endpoints ────────────────────────────────────────────────
@app.function(image=image, timeout=900)
@modal.fastapi_endpoint(method="POST", label="erase-subtitle-start")
def start_endpoint(payload: dict):
    video_url = payload.get("video_url") if isinstance(payload, dict) else None
    if not video_url or not isinstance(video_url, str):
        return {"error": "video_url (string) required"}
    fc = SubtitleRemover().process.spawn(video_url)
    return {"job_id": fc.object_id}


@app.function(image=image, timeout=30)
@modal.fastapi_endpoint(method="GET", label="erase-subtitle-status")
def status_endpoint(job_id: str):
    fc = modal.FunctionCall.from_id(job_id)
    try:
        result_bytes = fc.get(timeout=0)
        return {"status": "done", "size_bytes": len(result_bytes)}
    except modal.exception.OutputExpiredError:
        return {"status": "expired"}
    except TimeoutError:
        return {"status": "running"}
    except Exception as e:
        return {"status": "failed", "error": str(e)[:500]}


@app.function(image=image, timeout=60)
@modal.fastapi_endpoint(method="GET", label="erase-subtitle-result")
def result_endpoint(job_id: str):
    from fastapi.responses import Response

    fc = modal.FunctionCall.from_id(job_id)
    try:
        result_bytes = fc.get(timeout=5)
        return Response(
            content=result_bytes,
            media_type="video/mp4",
            headers={
                "Content-Disposition": 'attachment; filename="cleaned.mp4"',
                "Content-Length": str(len(result_bytes)),
            },
        )
    except Exception as e:
        return {"error": str(e)[:500]}


@app.local_entrypoint()
def test(video_url: str):
    print(f"Test: {video_url}")
    result = SubtitleRemover().process.remote(video_url)
    out_file = "test_output.mp4"
    with open(out_file, "wb") as f:
        f.write(result)
    print(f"Saved: {out_file} ({len(result) / 1024 / 1024:.1f}MB)")
