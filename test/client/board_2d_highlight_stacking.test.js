// ═══════════════════════════════════════════════════════════
//  2D BOARD — highlight overlay stacking regression test
//  Ensures .board2d-piece renders above .board2d-highlight overlay.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cssText = readFileSync(join(__dirname, '../../client/style.css'), 'utf-8');

function loadCSS() {
  const style = document.createElement('style');
  style.textContent = cssText;
  document.head.appendChild(style);
}

function clearDOM() {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
}

describe('2D board highlight stacking', () => {
  beforeEach(() => {
    clearDOM();
    loadCSS();
  });

  it('.board2d-piece has position set so z-index takes effect', () => {
    expect(cssText).toMatch(/\.board2d-piece\s*\{[^}]*position:\s*relative/);
  });

  it('.board2d-piece z-index is higher than highlight overlay z-index (5)', () => {
    const pieceMatch = cssText.match(/\.board2d-piece\s*\{[^}]*z-index:\s*(\d+)/);
    expect(pieceMatch).not.toBeNull();
    const pieceZIndex = parseInt(pieceMatch[1], 10);
    expect(pieceZIndex).toBeGreaterThan(5);
  });

  it('piece renders above highlight overlay in DOM stacking context', () => {
    const square = document.createElement('div');
    square.className = 'board2d-square light';
    square.style.position = 'relative';
    square.style.width = '60px';
    square.style.height = '60px';

    const piece = document.createElement('span');
    piece.className = 'board2d-piece white-piece';
    piece.textContent = '♔';

    const highlight = document.createElement('div');
    highlight.className = 'board2d-highlight';
    highlight.style.cssText = `
      position: absolute;
      inset: 0;
      background-color: #ffdd00;
      opacity: 0.55;
      pointer-events: none;
      z-index: 5;
    `;

    square.appendChild(piece);
    square.appendChild(highlight);
    document.body.appendChild(square);

    const pieceStyle = getComputedStyle(piece);
    const highlightStyle = getComputedStyle(highlight);

    expect(pieceStyle.position).toBe('relative');
    expect(parseInt(pieceStyle.zIndex, 10)).toBeGreaterThan(parseInt(highlightStyle.zIndex, 10));
  });
});
