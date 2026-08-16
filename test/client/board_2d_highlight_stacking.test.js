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

    const piece = document.createElement('img');
    piece.className = 'board2d-piece';
    piece.src = 'files/pieces/2d/mpchess/wK.svg';

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

describe('captured pieces — light inner box styling', () => {
  beforeEach(() => {
    clearDOM();
    loadCSS();
  });

  it('.cap-pieces has light background matching white board squares', () => {
    expect(cssText).toMatch(/\.cap-pieces\s*\{[^}]*background:\s*#f0d9b5/);
  });

  it('.cap-pieces uses flex layout with padding and border-radius', () => {
    expect(cssText).toMatch(/\.cap-pieces\s*\{[^}]*display:\s*flex/);
    expect(cssText).toMatch(/\.cap-pieces\s*\{[^}]*padding:\s*3px/);
    expect(cssText).toMatch(/\.cap-pieces\s*\{[^}]*border-radius:\s*4px/);
  });

  it('desktop captured container applies light background to .cap-pieces', () => {
    const container = document.createElement('div');
    container.id = 'captured-white';
    container.innerHTML = '<span class="cap-label">White</span><span class="cap-pieces"></span>';
    document.body.appendChild(container);

    const capPieces = container.querySelector('.cap-pieces');
    const style = getComputedStyle(capPieces);
    expect(style.display).toBe('flex');
    expect(style.backgroundColor).toBe('rgb(240, 217, 181)');
    expect(style.padding).toBe('3px');
  });

  it('drawer captured container applies light background to .cap-pieces', () => {
    const container = document.createElement('div');
    container.id = 'drawer-captured-white';
    container.innerHTML = '<span class="cap-label">White</span><span class="cap-pieces"></span>';
    document.body.appendChild(container);

    const capPieces = container.querySelector('.cap-pieces');
    const style = getComputedStyle(capPieces);
    expect(style.display).toBe('flex');
    expect(style.backgroundColor).toBe('rgb(240, 217, 181)');
    expect(style.padding).toBe('3px');
  });
});

describe('premove — exact deep-blue (#1e5ac8) styling values', () => {
  beforeEach(() => {
    clearDOM();
    loadCSS();
  });

  it('.premove-selected uses the pale premove-blue tint rgba(30, 90, 200, 0.25)', () => {
    expect(cssText).toMatch(
      /\.board2d-square\.premove-selected\s*\{[^}]*background-color:\s*rgba\(30,\s*90,\s*200,\s*0\.25\)/
    );
  });

  it('.premove-move dot uses rgba(30, 90, 200, 0.55)', () => {
    expect(cssText).toMatch(
      /\.board2d-square\.premove-move::after\s*\{[^}]*background-color:\s*rgba\(30,\s*90,\s*200,\s*0\.55\)/
    );
  });

  it('.premove-capture ring uses rgba(30, 90, 200, 0.55)', () => {
    expect(cssText).toMatch(
      /\.board2d-square\.premove-capture::after\s*\{[^}]*border:\s*3px\s+solid\s+rgba\(30,\s*90,\s*200,\s*0\.55\)/
    );
  });

  it('.premove-from and .premove-to use the solid premove-blue fill rgba(30, 90, 200, 0.45)', () => {
    expect(cssText).toMatch(
      /\.board2d-square\.premove-from,\s*\.board2d-square\.premove-to\s*\{[^}]*background-color:\s*rgba\(30,\s*90,\s*200,\s*0\.45\)/
    );
  });
});
