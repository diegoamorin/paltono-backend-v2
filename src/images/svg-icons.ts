import { SaxesAttributeNS, SaxesParser, SaxesTagNS } from 'saxes';

/** The heaviest platform icon accepted; a logo weighs a few KB. */
export const MAX_SVG_ICON_BYTES = 64 * 1024;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

/**
 * Namespaces of design tools (Inkscape, Sodipodi, Illustrator), whose elements
 * and attributes are dropped without complaint; Figma exports use none.
 */
const EDITOR_NAMESPACES = ['http://www.inkscape.org/namespaces/inkscape', 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd', 'http://ns.adobe.com/'];

const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'use',
  'title',
]);

/** Elements of the SVG namespace dropped with their content, as editors fill them with data nothing draws. */
const DROPPED_ELEMENTS = new Set(['metadata']);

/** Attributes without a namespace that only describe geometry or paint. */
const ATTRIBUTES = new Set([
  // Identity and accessibility (`aria-*` too).
  'id',
  'role',
  'version',
  // Viewport.
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  // Geometry.
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'offset',
  'transform',
  'transform-origin',
  // Gradients, clips and masks.
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  // Paint.
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'display',
  'visibility',
  'vector-effect',
  'shape-rendering',
  'paint-order',
]);

/** A reference inside the icon itself, `#id`. */
const INTERNAL_REFERENCE = /^#[A-Za-z_][\w.:-]*$/;

/** Every violation of an icon is reported at most once, and at most this many in all. */
export const MAX_SVG_VIOLATIONS = 20;
const MAX_NAME_LENGTH = 64;

export type SvgViolation =
  | { code: 'svg_too_large' | 'svg_unparseable' | 'svg_doctype_not_allowed' | 'svg_missing_viewbox' }
  | { code: 'svg_forbidden_element'; element: string }
  | { code: 'svg_forbidden_attribute' | 'svg_external_reference'; element: string; attribute: string };

export type SvgIconCheck = { ok: true; svg: Buffer; width: number; height: number } | { ok: false; violations: SvgViolation[] };

interface Element {
  tag: SaxesTagNS;
  children: (Element | string)[];
}

/**
 * Checks an uploaded platform icon against an allowlist of inert SVG (issue
 * #34): anything that could run, load or style is refused, never cleaned,
 * and every violation is named so the file can be fixed. An accepted icon is
 * rebuilt from what was checked, without comments, metadata or the markup of
 * design tools, so what is stored is exactly what passed.
 */
export function checkSvgIcon(file: Buffer): SvgIconCheck {
  if (file.length > MAX_SVG_ICON_BYTES) return refused({ code: 'svg_too_large' });
  const parsed = parse(file.toString('utf8'));
  if (parsed === 'doctype') return refused({ code: 'svg_doctype_not_allowed' });
  if (!parsed || parsed.tag.uri !== SVG_NAMESPACE || parsed.tag.local !== 'svg') return refused({ code: 'svg_unparseable' });

  const viewBox = viewBoxSize(parsed.tag.attributes.viewBox);
  const violations = new Violations();
  if (!viewBox) violations.add({ code: 'svg_missing_viewbox' });
  const svg = serialize(parsed, violations, true);
  if (violations.list.length > 0 || !viewBox) return { ok: false, violations: violations.list };
  return { ok: true, svg: Buffer.from(svg), ...viewBox };
}

function refused(violation: SvgViolation): SvgIconCheck {
  return { ok: false, violations: [violation] };
}

/** The root element, `doctype` when the file declares one, or null when it is not well-formed XML. */
function parse(text: string): Element | 'doctype' | null {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Element[] = [];
  let root: Element | null = null;
  let doctype = false;
  parser.on('doctype', () => {
    doctype = true;
  });
  parser.on('opentag', (tag) => {
    const element: Element = { tag, children: [] };
    stack.at(-1)?.children.push(element);
    stack.push(element);
    root ??= element;
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.on('text', (text) => stack.at(-1)?.children.push(text));
  parser.on('cdata', (text) => stack.at(-1)?.children.push(text));
  try {
    parser.write(text).close();
  } catch {
    return doctype ? 'doctype' : null;
  }
  return doctype ? 'doctype' : root;
}

/** Width and height of a `viewBox`, rounded up to whole pixels, or null when it is missing or invalid. */
function viewBoxSize(attribute: SaxesAttributeNS | undefined): { width: number; height: number } | null {
  const values = attribute?.value.trim().split(/[\s,]+/).map(Number);
  if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [, , width, height] = values;
  if (width <= 0 || height <= 0) return null;
  return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
}

/** The markup of an allowed element and its allowed content, recording what is refused on the way. */
function serialize({ tag, children }: Element, violations: Violations, root = false): string {
  const name = tag.local;
  const attributes = root ? [` xmlns="${SVG_NAMESPACE}"`] : [];
  for (const attribute of Object.values(tag.attributes)) {
    const written = serializeAttribute(name, attribute, violations);
    if (written) attributes.push(written);
  }
  const content = children
    .map((child) => {
      if (typeof child === 'string') return name === 'title' ? escape(child) : '';
      if (isEditorNamespace(child.tag.uri)) {
        refuseHiddenContent(child, violations);
        return '';
      }
      if (child.tag.uri === SVG_NAMESPACE && DROPPED_ELEMENTS.has(child.tag.local)) return '';
      if (child.tag.uri !== SVG_NAMESPACE || !ELEMENTS.has(child.tag.local)) {
        violations.add({ code: 'svg_forbidden_element', element: trim(qualifiedName(child.tag)) });
        return '';
      }
      return serialize(child, violations);
    })
    .join('');
  return content ? `<${name}${attributes.join('')}>${content}</${name}>` : `<${name}${attributes.join('')}/>`;
}

function serializeAttribute(element: string, attribute: SaxesAttributeNS, violations: Violations): string | null {
  const { uri, local, value } = attribute;
  if (uri === XMLNS_NAMESPACE || attribute.name === 'xmlns' || uri === XML_NAMESPACE || isEditorNamespace(uri)) return null;
  const isHref = local === 'href' && (uri === '' || uri === XLINK_NAMESPACE);
  if (!isHref && (uri !== '' || !(ATTRIBUTES.has(local) || local.startsWith('aria-')))) {
    violations.add({ code: 'svg_forbidden_attribute', element, attribute: trim(attribute.name) });
    return null;
  }
  if (isHref ? !INTERNAL_REFERENCE.test(value.trim()) : !onlyInternalUrls(value)) {
    violations.add({ code: 'svg_external_reference', element, attribute: trim(attribute.name) });
    return null;
  }
  // `href` without a namespace is SVG 2, understood by every current browser.
  return ` ${isHref ? 'href' : local}="${escape(isHref ? value.trim() : value)}"`;
}

/** Whether every `url(…)` in a value points inside the icon. */
function onlyInternalUrls(value: string): boolean {
  if (!/url\s*\(/i.test(value)) return true;
  const references = [...value.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].map(([, , reference]) => reference.trim());
  const calls = value.match(/url\s*\(/gi)?.length ?? 0;
  return references.length === calls && references.every((reference) => INTERNAL_REFERENCE.test(reference));
}

/**
 * Refuses what a design tool's element wraps besides its own markup: dropping
 * the element must not silently drop content such as a script hidden in it.
 */
function refuseHiddenContent({ children }: Element, violations: Violations): void {
  for (const child of children) {
    if (typeof child === 'string') continue;
    if (isEditorNamespace(child.tag.uri)) refuseHiddenContent(child, violations);
    else violations.add({ code: 'svg_forbidden_element', element: trim(qualifiedName(child.tag)) });
  }
}

function isEditorNamespace(uri: string): boolean {
  return uri !== '' && EDITOR_NAMESPACES.some((namespace) => uri.startsWith(namespace));
}

function qualifiedName(tag: SaxesTagNS): string {
  return tag.uri === SVG_NAMESPACE ? tag.local : tag.name;
}

/** A name as reported back: never its value, and never longer than a name needs. */
function trim(name: string): string {
  return name.slice(0, MAX_NAME_LENGTH);
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The distinct violations found, up to the reported maximum. */
class Violations {
  readonly list: SvgViolation[] = [];
  private readonly seen = new Set<string>();

  add(violation: SvgViolation): void {
    const key = JSON.stringify(violation);
    if (this.seen.has(key) || this.list.length >= MAX_SVG_VIOLATIONS) return;
    this.seen.add(key);
    this.list.push(violation);
  }
}
