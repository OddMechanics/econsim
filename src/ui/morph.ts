// Update a panel to new HTML by changing only what differs: text that
// changed, attributes that changed, nodes added or removed. Replacing the
// whole innerHTML several times a second throws away the element under the
// mouse (the hover highlight blinks), the text selection and focus; patching
// keeps them. Matching is by position, which suits these panels: rows that
// shift just get their text updated. Event handlers belong on the container
// (delegation), since nodes are reused for different rows.

/** Make `target`'s children match `html`. */
export function morphHTML(target: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(target, tpl.content);
}

/** Make `target`'s children match a list of freshly built nodes. */
export function morphNodes(target: Element, nodes: Node[]): void {
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  morphChildren(target, frag);
}

/** Make an element match another one (its attributes and children). */
export function morphElement(target: Element, next: Element): void {
  syncAttributes(target, next);
  morphChildren(target, next);
}

function syncAttributes(a: Element, b: Element): void {
  for (const attr of Array.from(a.attributes)) if (!b.hasAttribute(attr.name)) a.removeAttribute(attr.name);
  for (const attr of Array.from(b.attributes)) if (a.getAttribute(attr.name) !== attr.value) a.setAttribute(attr.name, attr.value);
}

function morphChildren(from: Node, to: Node): void {
  const a = Array.from(from.childNodes);
  const b = Array.from(to.childNodes);
  for (let i = 0; i < b.length; i++) {
    const nb = b[i], na = a[i];
    if (!na) { from.appendChild(nb); continue; }
    const same = na.nodeType === nb.nodeType && (na.nodeType !== Node.ELEMENT_NODE || (na as Element).tagName === (nb as Element).tagName);
    if (!same) { from.replaceChild(nb, na); continue; }
    if (na.nodeType !== Node.ELEMENT_NODE) {
      if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue;
      continue;
    }
    // a canvas keeps its drawing; everything else is patched recursively
    if ((na as Element).tagName === 'CANVAS') continue;
    syncAttributes(na as Element, nb as Element);
    morphChildren(na, nb);
  }
  for (let i = a.length - 1; i >= b.length; i--) from.removeChild(a[i]);
}
