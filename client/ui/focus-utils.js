// Focus management utilities shared across UI overlays

export function isActuallyVisible(element) {
  if (!element?.isConnected || element.disabled) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  );
}
