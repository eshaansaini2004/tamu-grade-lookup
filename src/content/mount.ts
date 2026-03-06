// Shadow DOM mounting utility for React panels injected into the page.
// Shadow DOM prevents Emotion/Schedule Builder CSS from leaking in.

import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

interface MountedPanel {
  host: HTMLElement;
  root: Root;
  shadow: ShadowRoot;
}

const mounted = new Map<string, MountedPanel>();

export function mountPanel(
  key: string,
  anchor: Element,
  position: 'before' | 'after',
  render: (shadow: ShadowRoot) => ReactNode,
  stylesheet?: string,
): MountedPanel {
  // Reuse existing mount if already there
  const existing = mounted.get(key);
  if (existing && document.contains(existing.host)) return existing;

  const host = document.createElement('div');
  host.dataset.trpPanel = key;
  const shadow = host.attachShadow({ mode: 'open' });

  if (stylesheet) {
    const style = document.createElement('style');
    style.textContent = stylesheet;
    shadow.appendChild(style);
  }

  const container = document.createElement('div');
  shadow.appendChild(container);

  const root = createRoot(container);
  root.render(render(shadow) as React.ReactElement);

  if (position === 'before') {
    anchor.before(host);
  } else {
    anchor.after(host);
  }

  const panel = { host, root, shadow };
  mounted.set(key, panel);
  return panel;
}

export function rerenderPanel(key: string, render: () => ReactNode): boolean {
  const existing = mounted.get(key);
  if (!existing || !document.contains(existing.host)) return false;
  existing.root.render(render() as React.ReactElement);
  return true;
}

export function unmountPanel(key: string) {
  const panel = mounted.get(key);
  if (!panel) return;
  panel.root.unmount();
  panel.host.remove();
  mounted.delete(key);
}
