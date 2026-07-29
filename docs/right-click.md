# Right-Click Arrow Drawing — Plan

## Overview

Add client-side arrow annotations drawn via right-click + drag + release. Arrows appear on both the 2D and 3D board, are purely local (never sent to the server), and are cleared only by a left-click on an interactive board.

## Core Behavior

- **One arrow per right-click + release operation.** Right-click on a square to start, release on a (different) square to finish.
- **Client-side only.** Arrows are stored in a local array. Never transmitted over WebSocket.
- **Cross-board visibility.** An arrow drawn on the 2D board also appears on the 3D board, and vice versa. A single source of truth drives both renderers.
- **Cleared on left-click on an interactive board.** A left-click on either the 2D or 3D board clears all arrows. Clicks outside the boards do not.
- **Square-to-square.** Arrows go from the center of one square to the center of another.
- **Knight-shape detection.** If the start and end squares form a valid knight move (L-shape: 2+1 or 1+2), the arrow follows a knight path (two connected segments). Otherwise it is a straight line.

## Data Model

A single array of arrow objects, shared between the 2D and 3D renderers:

```js
// arrows.js — new module
let arrows = []; // [{ from: {file, rank}, to: {file, rank}, color: string }, ...]

export function addArrow(from, to, color) { ... }
export function clearArrows() { ... }
export function getArrows() { ... }
export function onArrowChange(callback) { ... } // pub/sub so both boards re-render
```

## Arrow Colors

Arrows support four colors selected via keyboard modifiers held during the right-click gesture:

| Modifier | Color                   | Hex       |
| -------- | ----------------------- | --------- |
| None     | Neutral (charcoal gray) | `#444444` |
| `Ctrl`   | Red                     | `#ff4444` |
| `Alt`    | Blue                    | `#4488ff` |
| `Shift`  | Green                   | `#44cc44` |

The modifier is checked at the time of `mouseup` (button === 2) to determine the arrow color. If multiple modifiers are held, the priority is Ctrl > Alt > Shift. The color is stored with the arrow and used by both renderers.

Square-to-square centers in 3D world coordinates:

```
x = file - 3.5
z = 3.5 - rank
y = 0.062  (just above move dots at y=0.06 to avoid z-fighting)
```

## Deterministic Arrow Path (`getArrowPath`)

Both the 2D and 3D renderers consume a single shared helper so they always produce identical geometry for the same endpoints:

```js
export function getArrowPath(from, to) {
  const df = to.file - from.file;
  const dr = to.rank - from.rank;
  if (Math.abs(df) + Math.abs(dr) === 3 && Math.min(Math.abs(df), Math.abs(dr)) === 1) {
    // Knight move — deterministic bend: always draw the two-square leg first.
    const bend = {
      file: from.file + (Math.abs(df) === 2 ? Math.sign(df) * 2 : 0),
      rank: from.rank + (Math.abs(dr) === 2 ? Math.sign(dr) * 2 : 0),
    };
    return [from, bend, to];
  }
  return [from, to];
}
```

Rule: the two-square leg is always drawn first. This eliminates ambiguity — both renderers produce the same vertex list for every knight offset. All eight knight offsets are tested explicitly in unit tests to verify the bend coordinate.

## 3D Board Rendering (`board.js`)

- For each arrow, call `getArrowPath(from, to)` to obtain the vertex list.
- Render each segment as a flat line using Three.js `Line2` from the `three/examples` addons (supports configurable line width without 3D geometry). Ordinary WebGL `Line` objects do not support configurable line widths.
- Render the arrowhead as a flat triangle (`PlaneGeometry` or `BufferGeometry`) oriented face-up at the final vertex (`to`), pointing along the last segment direction.
- Use `LineMaterial` for each `Line2`, with `color` set to the arrow's color, `linewidth: 5`, and a `resolution` vector updated on resize. Use a matching `MeshBasicMaterial` for the flat triangle arrowhead. Cache materials by color. The line width should visually match the diameter of the move dots (~0.36 world units).
- For contrast against both light and dark squares, render a slightly thicker dark underlay line (e.g., `#111111` at 1.5× the colored line width) and a matching dark underlay arrowhead behind each colored line and arrowhead. This ensures all arrow colors remain visible regardless of the underlying square.
- On every arrow change (add or clear), remove old arrow meshes and create new ones from the `arrows` array.
- Arrows live in their own group (`arrowGroup`) added to the scene for easy batch removal.
- Arrow `y` position: `0.062` — just above move dots (`y=0.06`) to avoid z-fighting where arrows cross dots, while still appearing flush on the board.

## 2D Board Rendering (`board_2d.js`)

- For each arrow, call `getArrowPath(from, to)` to obtain the vertex list.
- For straight arrows (2 vertices), render an SVG `<line>` with a marker-end arrowhead.
- For knight arrows (3 vertices), render an SVG `<path>` with two line segments and a marker-end arrowhead.
- Set the `stroke` color of each arrow element to match the arrow's `color` property.
- For contrast against both light and dark squares, render a slightly thicker dark underlay (e.g., `#111111` at 1.5× the colored stroke width) behind each colored line and arrowhead. This ensures all arrow colors remain visible regardless of the underlying square.
- On every arrow change, clear and re-render all arrow elements from the `arrows` array.
- Compute pixel positions from square indices and the grid's DOM layout (e.g., `square.getBoundingClientRect()` or calculated from grid cell size).

## Interaction — 3D Board (`controls.js`)

Add right-click handling to the renderer's DOM element:

- **`contextmenu` event**: Prevent default context menu on the 3D canvas. Used only for menu suppression — not for starting or finishing the gesture.
- **`mousedown` (button === 2)**: If `mouseLookOn` is true, return immediately without raycasting or changing arrow state. Otherwise, raycast to find the start square. Store as `arrowStart`.
- **`mouseup` (button === 2)**: If `mouseLookOn` is true, return immediately. Otherwise, raycast to find the end square. If different from start, determine the arrow color from active modifiers (`event.ctrlKey`, `event.altKey`, `event.shiftKey`) and call `addArrow(start, end, color)`.

## Interaction — 2D Board (`board_2d.js`)

- **`contextmenu` event**: Prevent default context menu. Used only for menu suppression — not for starting or finishing the gesture.
- **`mousedown` (button === 2)**: Store start square.
- **`mouseup` (button === 2)**: Find end square, determine the arrow color from active modifiers (`event.ctrlKey`, `event.altKey`, `event.shiftKey`), add arrow.

## Clearing Arrows

A left-click **on either board** clears all arrows. The 3D board's click handler and the 2D board's click handler each call `clearArrows()` before processing their own logic. Clicks outside the boards (HUD buttons, empty space, etc.) do **not** clear arrows.

When in mouse look mode (`mouseLookOn`), the 3D board does not process board clicks at all, so arrows cannot be cleared through the 3D board. The 2D board is hidden in mouse look mode, so arrows are effectively locked while navigating the camera.

**Lifecycle cleanup** (separate from left-click clearing): arrows are also cleared on game restart (`onRestart` callback) and on page reload (state is lost naturally). These are cleanup paths, not the primary clearing mechanism.

## File Structure

```
client/
  arrows.js          NEW — shared arrow state, pub/sub
  board.js           MODIFIED — 3D arrow rendering, right-click handling
  board_2d.js        MODIFIED — 2D arrow rendering, right-click handling
  controls.js        MODIFIED — 3D right-click handling, clear on left-click
```

## Desktop-Only Scope

This feature is desktop-only. It requires a right-click capable input device (mouse with right button). Touch devices without an external mouse connected do not support arrow drawing. If a touch device has a mouse connected and the browser fires `mousedown` with `button === 2`, the feature works normally.

## Visual Design

- **Colors**: Charcoal gray `#444444` (default), red (Ctrl), blue (Alt), green (Shift). All colors have a dark underlay for contrast against both light squares (`#f0d9b5`) and dark squares (`#b58863`).
- **Thickness**: Line width matches the diameter of the move dots (~5px screen-space in both 2D and 3D). In 3D, `Line2` uses CSS-pixel `linewidth` by default; keep `worldUnits` at its default (`false`) so width is resolution-independent.
- **Arrowhead**: Small triangle at the destination square center, same color as the line.
- **Knight arrows**: Two connected segments with a single arrowhead at the end.
- **Multiple arrows**: All drawn simultaneously, no z-fighting issues (arrows are above the board surface).

## Edge Cases

- **Same square**: Right-clicking and releasing on the same square does nothing (no self-arrow).
- **Off-board release**: If the right-click release is outside the board, discard the arrow.
- **Arrow during game**: Arrows can be drawn at any time, regardless of turn or game state.
- **Board state change**: Arrows persist through moves (they are annotations, not move indicators).
- **Game restart**: Arrows are cleared on game restart (hook into `onRestart`) as lifecycle cleanup.

## Testing

- **Unit tests** (`test/client/arrows.test.js`):
  - `addArrow` / `clearArrows` / `getArrows` state management.
  - `getArrowPath` returns `[from, to]` for non-knight offsets.
  - `getArrowPath` returns `[from, bend, to]` for all 8 knight offsets — verify each bend coordinate explicitly.
  - Same-square rejection.
  - Color selection: no modifier = charcoal gray (`#444444`), Ctrl = red, Alt = blue, Shift = green, multiple modifiers use priority (Ctrl > Alt > Shift).
- **Integration / E2E tests** (`test/`):
  - Right-click on 3D board creates arrow visible on both boards.
  - Right-click on 2D board creates arrow visible on both boards.
  - Arrows render in the correct color on both boards.
  - Left-click on either board clears all arrows.
  - Left-click outside both boards (HUD, empty space) does NOT clear arrows.
  - In mouse look mode, right-click on the 3D board does NOT create arrows.
  - In mouse look mode, left-click on the 3D board does NOT clear arrows.
  - Game restart clears all arrows (lifecycle cleanup).
  - Multiple arrows of different colors accumulate correctly.
