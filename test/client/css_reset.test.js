import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the actual stylesheet so tests reflect real CSS
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

describe('CSS reset', () => {
  beforeEach(() => {
    clearDOM();
    loadCSS();
  });

  describe('box-sizing', () => {
    it('declares border-box on *, *::before, *::after', () => {
      expect(cssText).toContain('*::before');
      expect(cssText).toContain('*::after');
      expect(cssText).toMatch(/box-sizing:\s*border-box/);
    });
  });

  describe('margin reset', () => {
    it('removes default margin from all elements', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      expect(getComputedStyle(p).marginTop).toBe('0px');
      expect(getComputedStyle(p).marginBottom).toBe('0px');
    });

    it('removes default margin from headings', () => {
      const h1 = document.createElement('h1');
      document.body.appendChild(h1);
      expect(getComputedStyle(h1).marginTop).toBe('0px');
      expect(getComputedStyle(h1).marginBottom).toBe('0px');
    });
  });

  describe('padding reset', () => {
    it('removes default padding from ul', () => {
      const ul = document.createElement('ul');
      document.body.appendChild(ul);
      expect(getComputedStyle(ul).paddingLeft).toBe('0px');
    });

    it('removes default padding from ol', () => {
      const ol = document.createElement('ol');
      document.body.appendChild(ol);
      expect(getComputedStyle(ol).paddingLeft).toBe('0px');
    });

    it('removes default padding from input', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(getComputedStyle(input).paddingTop).toBe('0px');
      expect(getComputedStyle(input).paddingBottom).toBe('0px');
    });

    it('removes default padding from textarea', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      expect(getComputedStyle(textarea).paddingTop).toBe('0px');
      expect(getComputedStyle(textarea).paddingLeft).toBe('0px');
    });

    it('removes default padding from select', () => {
      const select = document.createElement('select');
      document.body.appendChild(select);
      expect(getComputedStyle(select).paddingTop).toBe('0px');
      expect(getComputedStyle(select).paddingLeft).toBe('0px');
    });

    it('declares padding: 0 in universal selector', () => {
      expect(cssText).toMatch(/\*\s*\{[^}]*padding:\s*0/);
    });
  });

  describe('html/body height', () => {
    it('sets html height to 100%', () => {
      expect(getComputedStyle(document.documentElement).height).toBe('100%');
    });

    it('sets body height to 100%', () => {
      expect(getComputedStyle(document.body).height).toBe('100%');
    });
  });

  describe('font smoothing', () => {
    it('declares -webkit-font-smoothing: antialiased on body', () => {
      expect(cssText).toContain('-webkit-font-smoothing: antialiased');
    });

    it('declares -moz-osx-font-smoothing: grayscale on body', () => {
      expect(cssText).toContain('-moz-osx-font-smoothing: grayscale');
    });
  });

  describe('media elements', () => {
    it('sets canvas to display: block', () => {
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      expect(getComputedStyle(canvas).display).toBe('block');
    });

    it('sets img to display: block', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);
      expect(getComputedStyle(img).display).toBe('block');
    });

    it('sets max-width: 100% on img', () => {
      const img = document.createElement('img');
      document.body.appendChild(img);
      expect(getComputedStyle(img).maxWidth).toBe('100%');
    });
  });

  describe('typography inheritance', () => {
    it('inherits font-family on code elements', () => {
      const code = document.createElement('code');
      document.body.appendChild(code);
      expect(getComputedStyle(code).fontFamily).toBe(getComputedStyle(document.body).fontFamily);
    });

    it('inherits font-family on pre elements', () => {
      const pre = document.createElement('pre');
      document.body.appendChild(pre);
      expect(getComputedStyle(pre).fontFamily).toBe(getComputedStyle(document.body).fontFamily);
    });
  });

  describe('button defaults', () => {
    it('inherits font on buttons', () => {
      document.body.style.fontFamily = 'monospace';
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      expect(getComputedStyle(btn).fontFamily).toBe('monospace');
    });

    it('sets button background to none', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      expect(getComputedStyle(btn).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    });

    it('sets button cursor to pointer', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      expect(getComputedStyle(btn).cursor).toBe('pointer');
    });
  });

  describe('input defaults', () => {
    it('inherits font on inputs', () => {
      document.body.style.fontFamily = 'Georgia, serif';
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(getComputedStyle(input).fontFamily).toBe('Georgia, serif');
    });

    it('inherits font on textarea', () => {
      document.body.style.fontFamily = 'Georgia, serif';
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      expect(getComputedStyle(textarea).fontFamily).toBe('Georgia, serif');
    });

    it('inherits font on select', () => {
      document.body.style.fontFamily = 'Georgia, serif';
      const select = document.createElement('select');
      document.body.appendChild(select);
      expect(getComputedStyle(select).fontFamily).toBe('Georgia, serif');
    });
  });

  describe('list styles', () => {
    it('declares list-style: none for ul and ol', () => {
      expect(cssText).toMatch(/ul[\s,]+ol\s*\{[^}]*list-style:\s*none/);
    });
  });

  describe('link defaults', () => {
    it('declares color: inherit on links', () => {
      expect(cssText).toMatch(/a\s*\{[^}]*color:\s*inherit/);
    });

    it('declares text-decoration: none on links', () => {
      expect(cssText).toMatch(/a\s*\{[^}]*text-decoration:\s*none/);
    });
  });

  describe('table defaults', () => {
    it('sets border-collapse to collapse', () => {
      const table = document.createElement('table');
      document.body.appendChild(table);
      expect(getComputedStyle(table).borderCollapse).toBe('collapse');
    });

    it('sets border-spacing to 0', () => {
      const table = document.createElement('table');
      document.body.appendChild(table);
      expect(getComputedStyle(table).borderSpacing).toBe('0px');
    });
  });

  describe('mobile touch', () => {
    it('sets touch-action: manipulation on inputs', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(getComputedStyle(input).touchAction).toBe('manipulation');
    });

    it('sets touch-action: manipulation on buttons', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      expect(getComputedStyle(btn).touchAction).toBe('manipulation');
    });

    it('sets font-size 16px on inputs to prevent iOS zoom', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      expect(getComputedStyle(input).fontSize).toBe('16px');
    });

    it('sets font-size 16px on textarea to prevent iOS zoom', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      expect(getComputedStyle(textarea).fontSize).toBe('16px');
    });
  });

  describe('application overrides', () => {
    it('sets body background to #1a1410', () => {
      expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(26, 20, 16)');
    });

    it('sets overflow hidden on body', () => {
      expect(getComputedStyle(document.body).overflow).toBe('hidden');
    });

    it('sets overflow hidden on html', () => {
      expect(getComputedStyle(document.documentElement).overflow).toBe('hidden');
    });
  });
});
