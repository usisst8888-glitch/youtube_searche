# AI 쇼츠 자동 생성 프로젝트 기획서

## 🎬 전체 파이프라인

```
[Tab 1] 참고 영상 선택 → 대본 추출 → 구조 분석 → 새 대본 생성
          ↓
[Tab 2] 상품 이미지 업로드 → 섹션별 이미지 생성
          ↓
[Tab 3] 이미지 → 동영상 (움직임 부여)
          ↓
[Tab 4] TTS 음성 합성 + 자막 오버레이
          ↓
[Tab 5] BGM 생성/믹스 → 최종 MP4 다운로드
```

---

## 🧩 각 단계 기술 선택 및 비용

### Tab 1: 대본 추출 / 분석 / 생성

| 단계 | 기술 | 비용 (1편당) |
|------|------|--------------|
| 자막 추출 | `youtube-transcript` npm (YouTube 공식 자막) | 무료 |
| 자막 없는 경우 | Whisper API (OpenAI) or Gemini 오디오 입력 | $0.006~ |
| 구조 분석 + 새 대본 | **Gemini 2.5 Flash** | $0.01~0.05 |

**주의**: YouTube는 일부 쇼츠 자막이 없음 → **Gemini 2.5 Pro가 비디오/오디오 직접 입력 가능**하니 자막 없으면 영상 URL로 바로 분석도 가능 (한도 있음).

### Tab 2: 이미지 생성

| 옵션 | 장점 | 비용 |
|------|------|------|
| **Gemini 2.5 Flash Image** (Nano Banana) | 한국어 지원, 상품 이미지 참조 기반 편집 강력 | **$0.039/장** |
| FAL.ai (Flux Kontext) | 상품 일관성 최고 | $0.04~0.08/장 |
| Google Imagen 4 | 고품질, 느림 | $0.02~0.04/장 |

**쇼츠 기준 4~6장** 생성 → **$0.15~0.3 per 영상**

### Tab 3: 이미지 → 동영상 (여기가 제일 비쌈)

| 옵션 | 품질 | 비용 (5초 클립) |
|------|------|-----------------|
| **Runway Gen-4 Turbo** | 우수 | $0.25~0.50 |
| **Kling 2.5** | 우수 (움직임 자연) | $0.35~0.80 |
| **Luma Ray 2** | 중간 | $0.20~0.40 |
| **Pika 2.2** | 중간 | $0.15~0.30 |
| **Veo 3 (Google)** | 최상급 (오디오 포함) | $0.50~1.50 |

**30초 쇼츠 = 5초짜리 5~6개 이어붙임** → **$1.5~3 per 영상** (가장 큰 비용)

### Tab 4: TTS

| 옵션 | 품질 | 비용 |
|------|------|------|
| **Google Cloud TTS** (Chirp 3 HD) | 자연스러움 | ~$0.016/1K 문자 |
| **ElevenLabs** | 최고 품질 | $0.3~1/분 |
| **OpenAI TTS** | 좋음, 한국어 OK | $15/1M 문자 |

30초 대본 (~400자) → **$0.01~0.05 per 영상**

### Tab 5: BGM

| 옵션 | 비용 |
|------|------|
| **Suno API** (v5) | $0.05~0.10/곡 |
| **Udio** | $0.08~0.15/곡 |
| **ElevenLabs Music** | $0.30~1/곡 |
| **무료 라이브러리** (YouTube Audio Library 등) | 무료 (수동) |

### 최종 합성

FFmpeg (서버리스에서 가능) — **무료**

---

## 💰 쇼츠 1편 제작 총비용 (예상)

| 항목 | 비용 |
|------|------|
| 대본 분석/생성 (Gemini) | $0.03 |
| 이미지 생성 × 5장 | $0.20 |
| **비디오 생성 × 6클립** ⭐ 메인 비용 | **$2.00** |
| TTS | $0.03 |
| BGM | $0.07 |
| **합계** | **~$2.30 (3천원)** |

하루 10편 = **월 70만원**, 3편 = 21만원. 비디오 생성이 압도적 비용 → 여기를 어떻게 설계하느냐가 핵심.

---

## ⚠️ 미리 결정해야 할 사항

### 1. "이미지 → 비디오"의 움직임 정도

- **A. 진짜 AI 비디오 생성** (Runway/Kling) → 비쌈, 1편 $2~3
- **B. Ken Burns 효과** (이미지에 줌/팬만 추가) → FFmpeg로 무료, 훨씬 저렴
- **C. 하이브리드** (상품 쇼트만 AI 비디오, 나머지는 Ken Burns)

**추천: B 또는 C로 MVP → 돈 받을 만큼 되면 A로 업그레이드**

### 2. 저장소

- 이미지/비디오 파일 → Vercel Blob, Supabase Storage, Cloudflare R2 중 하나 필요
- **Cloudflare R2 권장** (egress 무료, 가장 저렴)

### 3. 장시간 작업 처리

- Vercel 서버리스는 **최대 60초**
- 비디오 생성은 5~10분 걸림 → **백그라운드 작업 큐** 필요
- 옵션: Inngest, Upstash QStash, Trigger.dev, Vercel Background Functions

### 4. 상태 관리 / 프로젝트 저장

- 작업 내역 저장하려면 DB 필요 → Supabase/Neon (무료 티어 OK)
- 단순 1회성이면 브라우저 state로 충분

---

## 🎯 MVP 제안 (2주 현실 버전)

```
Week 1:
 [Tab 1] YouTube URL → 자막 추출 → Gemini로 대본 분석/재생성
 [Tab 2] 상품 이미지 업로드 → Gemini Flash Image로 섹션 이미지 생성

Week 2:
 [Tab 3] FFmpeg로 이미지 + Ken Burns 효과 + 타이밍 맞춘 영상 합성
 [Tab 4] Google TTS로 음성 → FFmpeg로 오버레이
 [Tab 5] 나중에 (Suno API 연동)
```

**이 MVP 기준**:
- **1편 제작비: $0.30** (비디오 생성 없어서 10배 절감)
- **품질**: "이미지 슬라이드쇼 + Ken Burns + TTS" = 실제 쇼핑 쇼츠와 매우 유사
- 완성 후 AI 비디오 생성 옵션 추가해도 늦지 않음

---

## 🤔 확정이 필요한 질문들

1. **참고 영상 분석** — 대본만 참고? 아니면 영상 구조/편집 스타일까지?
2. **상품 이미지** — 몇 장 넣을 건가요? (1개 상품에 사진 여러 장? 여러 상품?)
3. **비디오 스타일** — 정적 이미지 슬라이드(저비용) vs AI 생성 움직임(고비용) 어느 쪽 우선?
4. **최종 출력** — 다운로드만? 아니면 자동 업로드까지?
5. **사용자** — 본인 혼자? 지인도 씀? 판매? (사용자 수가 설계에 영향)

---

## 📚 관련 링크

- Gemini API 가격: https://ai.google.dev/pricing
- Gemini Flash Image (Nano Banana): https://ai.google.dev/gemini-api/docs/image-generation
- Runway API: https://dev.runwayml.com/
- Kling API: https://app.klingai.com/
- Suno API: https://suno.com/
- Google Cloud TTS: https://cloud.google.com/text-to-speech
- youtube-transcript (npm): https://www.npmjs.com/package/youtube-transcript
