"""
Subtitle Remover — v7 SD-1.5 Inpainting + clean plate

v5(ProPainter) → v7(SD-1.5):
- ProPainter 버림. Diffusion 기반 SD-1.5 Inpainting으로 갈아엎음
  · GAN 기반 LaMa의 hallucination이 어색 → Diffusion이 훨씬 자연스러운 배경 생성
  · 학습 데이터가 어마어마하게 많아서 일상 패턴(타일, 벽, 가구, 풍경) 진짜처럼 그림
  · prompt로 컨트롤 가능 ("natural background, photorealistic")
- 구조: v4(clean plate + 보간) 그대로, LaMa만 SD-1.5로 교체
- GPU: A10G (SD-1.5는 메모리 4GB이라 T4도 OK이지만 A10G가 빠름)

배포: modal deploy modal/subtitle_remover.py
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
        # PyTorch + LaMa (simple-lama)
        "torch==2.1.0",
        "torchvision==0.16.0",
        "simple-lama-inpainting==0.1.2",
        # OCR + 영상/이미지
        "easyocr==1.7.1",
        "opencv-python==4.8.1.78",
        "numpy<2",
        "pillow",
        "tqdm",
        # web
        "fastapi",
    )
    .run_commands(
        # LaMa 가중치 사전 다운로드
        'python -c "from simple_lama_inpainting import SimpleLama; SimpleLama()"',
        # EasyOCR
        'python -c "import easyocr; easyocr.Reader([\\"ch_sim\\",\\"en\\"], gpu=False, verbose=False)"',
    )
)


@app.cls(
    image=image,
    gpu="L4",
    timeout=1500,
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
        print("[init] Models ready (LaMa)")

    def _sd_inpaint(self, img_bgr, mask_gray):
        """크롭된 이미지 + 마스크 → LaMa inpainting 결과 (BGR).
        (함수명은 호환성 위해 _sd_inpaint 유지, 내부는 LaMa 사용)"""
        import numpy as np
        import cv2
        from PIL import Image

        ch, cw = img_bgr.shape[:2]
        # 짧은 변 480 초과면 480으로 줄여서 LaMa → 빠름. 결과는 원본 크기로 복원.
        short = min(ch, cw)
        if short > 480:
            scale = 480 / short
            new_w = max(8, int(round(cw * scale / 8)) * 8)
            new_h = max(8, int(round(ch * scale / 8)) * 8)
            img_in = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)
            mask_in = cv2.resize(mask_gray, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
        else:
            img_in, mask_in = img_bgr, mask_gray

        img_rgb = cv2.cvtColor(img_in, cv2.COLOR_BGR2RGB)
        result_pil = self.lama(Image.fromarray(img_rgb), Image.fromarray(mask_in))
        result_rgb = np.array(result_pil)
        ih, iw = img_in.shape[:2]
        if result_rgb.shape[:2] != (ih, iw):
            result_rgb = result_rgb[:ih, :iw]
        result_bgr = cv2.cvtColor(result_rgb, cv2.COLOR_RGB2BGR)

        if result_bgr.shape[:2] != (ch, cw):
            result_bgr = cv2.resize(result_bgr, (cw, ch), interpolation=cv2.INTER_LANCZOS4)
        return result_bgr

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

            # Pass 1 — 매 프레임 OCR로 frame_masks + union_mask 동시 생성
            # (타이핑 효과 등 동적 자막에 대응)
            print("[3/6] Pass 1: OCR every frame → per-frame masks + union")
            # 더 큰 dilate (20px) — 글자 외곽선/그림자까지 덮음
            dilate_k = cv2.getStructuringElement(cv2.MORPH_RECT, (41, 41))
            # close — 글자 사이 빈 공간 메꿈 (가로 25px, 세로 12px)
            close_k = cv2.getStructuringElement(cv2.MORPH_RECT, (51, 25))
            frame_masks: dict[int, np.ndarray] = {}
            union_mask = np.zeros((height, width), dtype=np.uint8)
            cap = cv2.VideoCapture(str(in_720))
            for idx in range(total_frames):
                ret, img = cap.read()
                if not ret:
                    break
                m = np.zeros((height, width), dtype=np.uint8)
                try:
                    horiz_list, free_list = self.reader.detect(img)
                except Exception as e:
                    print(f"  OCR err frame {idx}: {e}")
                    frame_masks[idx] = m
                    continue
                if horiz_list and len(horiz_list) > 0:
                    for box in horiz_list[0] or []:
                        if not box or len(box) < 4:
                            continue
                        x1, x2, y1, y2 = box
                        x1, y1 = max(0, int(x1)), max(0, int(y1))
                        x2, y2 = min(width, int(x2)), min(height, int(y2))
                        if (x2 - x1) > 10 and (y2 - y1) > 10:
                            m[y1:y2, x1:x2] = 255
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
                            m[y1:y2, x1:x2] = 255
                if m.any():
                    # close → 글자 사이 메꿈 → dilate → 외곽까지 확장
                    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, close_k)
                    m = cv2.dilate(m, dilate_k, iterations=1)
                frame_masks[idx] = m
                union_mask = np.maximum(union_mask, m)
            cap.release()
            coverage = int(union_mask.sum() // 255)
            n_with_text = sum(1 for m in frame_masks.values() if m.any())
            print(
                f"  frames with text: {n_with_text}/{total_frames}, "
                f"union coverage={coverage}px"
            )

            if coverage == 0:
                print("  no text → return downscaled original")
                return in_720.read_bytes()

            # Pass 2 — 매 프레임 동적 crop (자막 bbox만) + LaMa
            pad = 60
            print(
                "[4/5] Pass 2: LaMa inpaint every frame "
                "(dynamic crop per-frame, 480p resize internally)"
            )
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
            n_inpainted = 0
            for idx in range(total_frames):
                ret, img = cap.read()
                if not ret:
                    break
                fm_full = frame_masks.get(idx)
                if fm_full is None or not fm_full.any():
                    encoder.stdin.write(img.tobytes())
                    if idx % 30 == 0:
                        print(f"  {idx}/{total_frames} (skip-no-text)")
                    continue

                # 이 프레임의 동적 crop (자막 bbox + 패딩)
                ys, xs = np.where(fm_full > 127)
                y1, y2 = int(ys.min()), int(ys.max()) + 1
                x1, x2 = int(xs.min()), int(xs.max()) + 1
                y1, y2 = max(0, y1 - pad), min(height, y2 + pad)
                x1, x2 = max(0, x1 - pad), min(width, x2 + pad)

                fm_crop = fm_full[y1:y2, x1:x2]
                img_crop = img[y1:y2, x1:x2]
                try:
                    cleaned_bgr = self._sd_inpaint(img_crop, fm_crop)
                except Exception as e:
                    print(f"  inpaint err {idx}: {e}")
                    encoder.stdin.write(img.tobytes())
                    continue

                fm_feather = cv2.GaussianBlur(fm_crop, (15, 15), 0)
                alpha = (fm_feather.astype(np.float32) / 255.0)[:, :, None]
                blended = img_crop * (1 - alpha) + cleaned_bgr * alpha
                img[y1:y2, x1:x2] = blended.astype(np.uint8)
                encoder.stdin.write(img.tobytes())
                n_inpainted += 1
                if idx % 10 == 0:
                    print(
                        f"  {idx}/{total_frames} (inpainted so far: {n_inpainted})"
                    )
            cap.release()
            encoder.stdin.close()
            encoder.wait()
            print(f"  total inpainted frames: {n_inpainted}/{total_frames}")

            print("[5/5] Mux original audio")
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
    with open("test_output.mp4", "wb") as f:
        f.write(result)
    print(f"Saved: test_output.mp4 ({len(result) / 1024 / 1024:.1f}MB)")
