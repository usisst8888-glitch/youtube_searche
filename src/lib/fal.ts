import { fal } from "@fal-ai/client";

let configured = false;

export function getFal() {
  if (!configured) {
    const key = process.env.FAL_KEY;
    if (!key) {
      throw new Error("FAL_KEY가 설정되지 않았습니다.");
    }
    fal.config({ credentials: key });
    configured = true;
  }
  return fal;
}
