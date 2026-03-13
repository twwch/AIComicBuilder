# Batch Loading Propagation Design Spec
Date: 2026-03-13

## Overview

When a batch generation operation runs, only the top-level batch button shows a loading state. Each child card's own generation button has no awareness that a batch is in progress. This spec covers propagating batch loading state down to the individual card buttons so that cards that **need** generation show a loading state while the batch runs.

## Approach

Pass batch loading state as optional props from parent pages to child card components. Child components derive whether to show loading based on the prop **and** whether they need generation (no existing output). This avoids changes to global state and follows the existing props-down pattern.

No intermediate wrapper components exist between the pages and the cards — both `CharacterCard` and `ShotCard` are rendered directly in the page's `.map()` calls, so prop threading only requires updating 4 files.

---

## CharacterCard Changes

**File:** `src/components/editor/character-card.tsx`

Add one optional prop:
```ts
batchGenerating?: boolean
```

The "Generate Turnaround" button shows loading when:
```tsx
const isGenerating = generating || (!!batchGenerating && !referenceImage);
```
- `generating`: own single-card generation is in progress (existing behavior)
- `batchGenerating && !referenceImage`: batch is running AND this card has no image (it's a batch target)

Cards with an existing `referenceImage` will NOT show loading during batch — they are not batch targets.

---

## ShotCard Changes

**File:** `src/components/editor/shot-card.tsx`

Add two optional props:
```ts
batchGeneratingFrames?: boolean
batchGeneratingVideo?: boolean
```

**"Generate Frames" button** derived loading state:
```tsx
const isGeneratingFrames = generatingFrames || (!!batchGeneratingFrames && !firstFrame && !lastFrame);
```
- Shows loading when batch is running AND this shot has no frames yet

**"Generate Video" button** derived loading state:
```tsx
const isGeneratingVideo = generatingVideo || (!!batchGeneratingVideo && !!firstFrame && !!lastFrame && !videoUrl);
```
- Shows loading when batch is running AND this shot has frames (prerequisite for video) but no video yet
- **Both** `firstFrame` AND `lastFrame` must be non-null for a shot to participate in video generation. This mirrors the existing JSX guard: the "Generate Video" button is only rendered when `firstFrame && lastFrame` are both present. A shot with only one frame is excluded from the batch and will NOT show loading.

**Dual render locations:** Each of these two buttons appears in **two JSX locations** within `shot-card.tsx` — the collapsed header strip and the expanded detail panel. Both locations use the same underlying `handleGenerateFrames` / `handleGenerateVideo` handlers. The derived booleans `isGeneratingFrames` and `isGeneratingVideo` must be applied to **both** render locations for each button.

**Failure edge case:** If batch generation completes (or errors) and a card received no output (e.g., the API failed for one item), `generatingFrames` / `generatingVideos` will be reset to `false` in the parent, and the card's loading state will disappear. The card will show no error indicator — this is acceptable given that no per-item error handling exists in the current architecture.

---

## Parent Page Changes

**`src/app/[locale]/project/[id]/characters/page.tsx`**

Pass `batchGenerating={generatingImages}` to every `<CharacterCard>`:
```tsx
<CharacterCard
  ...existing props...
  batchGenerating={generatingImages}
/>
```

**`src/app/[locale]/project/[id]/storyboard/page.tsx`**

Pass both batch states to every `<ShotCard>`:
```tsx
<ShotCard
  ...existing props...
  batchGeneratingFrames={generatingFrames}
  batchGeneratingVideo={generatingVideos}
/>
```

---

## Affected Files (4 files)

| File | Change |
|------|--------|
| `src/components/editor/character-card.tsx` | Add `batchGenerating?` prop; derive `isGenerating`; apply to generate button |
| `src/app/[locale]/project/[id]/characters/page.tsx` | Pass `batchGenerating={generatingImages}` to CharacterCard in map |
| `src/components/editor/shot-card.tsx` | Add `batchGeneratingFrames?` + `batchGeneratingVideo?` props; derive booleans; apply to both render locations for each button |
| `src/app/[locale]/project/[id]/storyboard/page.tsx` | Pass `batchGeneratingFrames={generatingFrames}` + `batchGeneratingVideo={generatingVideos}` to ShotCard in map |

---

## Eligibility Logic Summary

| Card | Prop | Shows loading when batch prop is true AND... |
|------|------|----------------------------------------------|
| CharacterCard | `batchGenerating` | `referenceImage === null` |
| ShotCard (frames button) | `batchGeneratingFrames` | `!firstFrame && !lastFrame` |
| ShotCard (video button) | `batchGeneratingVideo` | `firstFrame && lastFrame && !videoUrl` |

## What is NOT in scope

- Per-item progress tracking (which specific card is being processed right now)
- Per-item error display on batch failure
- Polling for real-time status updates
- Changes to batch API endpoints
- i18n changes
