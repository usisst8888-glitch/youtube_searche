# Subtitle Remover — Modal Deployment Guide

PaddleOCR + LaMa로 자동 자막 제거. Modal Labs 서버리스 GPU에서 동작.

## 0. 사전 준비

```bash
# Modal CLI 설치
pip3 install modal

# Modal 계정 연결 (브라우저 GitHub 로그인)
modal setup

# 확인
modal token current
```

## 1. 배포

```bash
# 프로젝트 루트에서
modal deploy modal/subtitle_remover.py
```

처음 deploy는 **5~10분** 걸려요:
- Docker 이미지 빌드 (Modal 서버에서)
- LaMa 가중치 다운로드 (720MB)
- PaddleOCR 모델 다운로드 (200MB)

성공하면 endpoint URL 3개 출력됨:
```
✓ Created web endpoint: https://{사용자명}--subtitle-remover-start-endpoint.modal.run
✓ Created web endpoint: https://{사용자명}--subtitle-remover-status-endpoint.modal.run
✓ Created web endpoint: https://{사용자명}--subtitle-remover-result-endpoint.modal.run
```

이 URL들을 `.env.local`에 추가:

```
MODAL_START_URL=https://{사용자명}--subtitle-remover-start-endpoint.modal.run
MODAL_STATUS_URL=https://{사용자명}--subtitle-remover-status-endpoint.modal.run
MODAL_RESULT_URL=https://{사용자명}--subtitle-remover-result-endpoint.modal.run
```

## 2. 단독 테스트 (Next.js 없이)

영상 1편 처리해서 비용·시간 확인:

```bash
# Supabase storage 등 공개 URL 사용
modal run modal/subtitle_remover.py::test --video-url "https://your-video-url.mp4"
```

출력:
- `test_output.mp4` (결과 영상)
- 처리된 프레임 수, 비용은 Modal 대시보드(https://modal.com/apps)에서 확인

## 3. 업데이트

코드 수정 후 다시 deploy:
```bash
modal deploy modal/subtitle_remover.py
```

기존 URL은 유지됨 (변경 없음).

## 4. 모니터링

```bash
# 실행 중인 함수 확인
modal app list

# 로그 보기
modal app logs subtitle-remover
```

## 5. 삭제 (서비스 종료 시)

```bash
modal app stop subtitle-remover
```

## 비용 예상

| 영상 | 처리 시간 | 비용 |
|------|----------|------|
| 60초 720×1280, 자막 100% | \~50초 | **\~30원** |
| 60초 720×1280, 자막 50% | \~35초 | **\~22원** |
| 60초 1080×1920, 자막 100% | \~100초 | **\~60원** |
| 30초 720×1280, 자막 50% | \~18초 | **\~12원** |

A10G GPU 시간당 \$1.10 = 1,430원/시간 기준.

50편/일 × 30일 = 월 1,500편:
- worst case: \~45,000원/월
- typical: \~30,000원/월

## 문제 해결

### "GPU 부족" 에러
- A10G 가용성 부족 → `T4`로 임시 변경:
  ```python
  @app.function(..., gpu="T4")
  ```

### Cold start 너무 느림
- `min_containers=1`로 keep warm (24시간 GPU 비용 발생, 50편/일 미만이면 비용 더 듦)
- 또는 그냥 첫 호출 시 한 번만 느림 인정

### 이미지 빌드 실패
- Modal 대시보드 → Builds 탭에서 로그 확인
- 보통 PyPI 패키지 버전 충돌 → requirements 조정
