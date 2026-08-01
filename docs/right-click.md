# Right-Click Annotations

Right-click annotations let players annotate the board with colored arrows and square highlights visible on both the 2D and 3D boards. Annotations are client-side only — they are never sent to the server.

## Drawing Arrows

Right-click on a square, drag to a different square, and release. An arrow appears from the start square center to the end square center. Drawing on the same square does nothing.

Arrows drawn on either the 2D or 3D board appear on both simultaneously.

## Highlighting Squares

Right-click a single square and release without dragging to highlight it. The highlight uses the same color system as arrows. Multiple highlights on the same square replace each other rather than stacking.

## Annotation Colors

Hold a keyboard modifier while releasing the right-click to choose a color:

| Modifier | Color  |
| -------- | ------ |
| None     | Yellow |
| Ctrl     | Red    |
| Alt      | Blue   |
| Shift    | Green  |

When multiple modifiers are held, priority is Ctrl > Alt > Shift.

## Arrow Shapes

- **Straight arrows**: drawn between any two squares.
- **Knight arrows**: when the start and end squares form a valid knight move (L-shape), the arrow bends at the corner with two connected segments.

## Clearing Annotations

Left-click anywhere on the board to clear all arrows and highlights. Annotations are also cleared when a game restarts.

## Limitations

- **Desktop only**. Requires a mouse with a right button.
- **Disabled in camera mode** on the 3D board. Annotations cannot be drawn or cleared while mouse look is active.
- Multiple arrows accumulate; there is no limit.
