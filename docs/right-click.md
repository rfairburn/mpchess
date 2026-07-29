# Right-Click Arrow Annotations

Right-click arrow drawing lets players annotate the board with colored arrows visible on both the 2D and 3D boards. Arrows are client-side only — they are never sent to the server.

## Drawing Arrows

Right-click on a square, drag to a different square, and release. An arrow appears from the start square center to the end square center. Drawing on the same square does nothing.

Arrows drawn on either the 2D or 3D board appear on both simultaneously.

## Arrow Colors

Hold a keyboard modifier while releasing the right-click to choose a color:

| Modifier | Color |
| -------- | ----- |
| None     | White |
| Ctrl     | Red   |
| Alt      | Blue  |
| Shift    | Green |

When multiple modifiers are held, priority is Ctrl > Alt > Shift.

## Arrow Shapes

- **Straight arrows**: drawn between any two squares.
- **Knight arrows**: when the start and end squares form a valid knight move (L-shape), the arrow bends at the corner with two connected segments.

## Clearing Arrows

Left-click anywhere on the board to clear all arrows. Arrows are also cleared when a game restarts.

## Limitations

- **Desktop only**. Requires a mouse with a right button.
- **Disabled in camera mode** on the 3D board. Arrows cannot be drawn or cleared while mouse look is active.
- Multiple arrows accumulate; there is no limit.
