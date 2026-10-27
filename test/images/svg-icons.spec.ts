import { MAX_SVG_ICON_BYTES, checkSvgIcon } from '../../src/images/svg-icons';

const svg = (body: string, attributes = 'viewBox="0 0 24 24"') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`);

/** The stored markup of an accepted icon. */
function accepted(file: Buffer): string {
  const check = checkSvgIcon(file);
  if (!check.ok) throw new Error(`Refused: ${JSON.stringify(check.violations)}`);
  return check.svg.toString();
}

function violations(file: Buffer) {
  const check = checkSvgIcon(file);
  if (check.ok) throw new Error(`Accepted: ${check.svg.toString()}`);
  return check.violations;
}

describe('checkSvgIcon', () => {
  it('accepts a simple icon and keeps it as an SVG with the size of its viewBox', () => {
    const check = checkSvgIcon(svg('<title>Spotify</title><path d="M12 0C5.4 0 0 5.4 0 12"/>', 'role="img" viewBox="0 0 24 24"'));

    expect(check).toEqual({ ok: true, svg: expect.any(Buffer), width: 24, height: 24 });
    expect(accepted(svg('<title>Spotify</title><path d="M12 0C5.4 0 0 5.4 0 12"/>', 'role="img" viewBox="0 0 24 24"'))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 24 24"><title>Spotify</title><path d="M12 0C5.4 0 0 5.4 0 12"/></svg>',
    );
  });

  it('accepts gradients, clips, masks and uses that reference elements of the icon', () => {
    const icon = svg(
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
        '<clipPath id="c"><circle cx="12" cy="12" r="10"/></clipPath><path id="p" d="M0 0h4v4z"/></defs>' +
        '<g clip-path="url(#c)" aria-label="logo"><rect width="24" height="24" fill="url(\'#g\')"/>' +
        '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#p" transform="translate(2 2)"/></g>',
    );

    expect(accepted(icon)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
        '<clipPath id="c"><circle cx="12" cy="12" r="10"/></clipPath><path id="p" d="M0 0h4v4z"/></defs>' +
        '<g clip-path="url(#c)" aria-label="logo"><rect width="24" height="24" fill="url(\'#g\')"/>' +
        '<use href="#p" transform="translate(2 2)"/></g></svg>',
    );
  });

  it('drops comments, metadata and the markup of design tools from an exported icon', () => {
    const exported = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        '<!-- Generator: Adobe Illustrator 27.0 -->\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
        'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" ' +
        'version="1.1" viewBox="0 0 48 24" inkscape:version="1.3" xml:space="preserve">\n' +
        '  <metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata>\n' +
        '  <sodipodi:namedview pagecolor="#fff"/>\n' +
        '  <i:pgf>data</i:pgf>\n' +
        '  <g inkscape:label="Layer 1" inkscape:groupmode="layer"><path d="M0 0h48v24z" fill="#1DB954"/></g>\n' +
        '</svg>\n',
    );

    expect(accepted(exported)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 48 24"><g><path d="M0 0h48v24z" fill="#1DB954"/></g></svg>',
    );
  });

  it('refuses what a design tool element hides', () => {
    const icon = svg(
      '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><sodipodi:guide/><script>alert(1)</script></sodipodi:namedview>',
    );

    expect(violations(icon)).toEqual([{ code: 'svg_forbidden_element', element: 'script' }]);
  });

  it('sizes an icon that is not square by its viewBox, rounded up to whole pixels', () => {
    expect(checkSvgIcon(svg('<path d="M0 0h1z"/>', 'viewBox="-2 0 63.2 20.5"'))).toMatchObject({ ok: true, width: 64, height: 21 });
  });

  it.each([
    ['a script', '<script>alert(1)</script>', { code: 'svg_forbidden_element', element: 'script' }],
    ['a stylesheet', '<style>path{fill:url(https://evil.example)}</style>', { code: 'svg_forbidden_element', element: 'style' }],
    ['foreign HTML', '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>', { code: 'svg_forbidden_element', element: 'foreignObject' }],
    ['an image', '<image href="https://evil.example/a.png"/>', { code: 'svg_forbidden_element', element: 'image' }],
    ['a link', '<a href="https://evil.example"><path d="M0 0z"/></a>', { code: 'svg_forbidden_element', element: 'a' }],
    ['an animation', '<path d="M0 0z"><animate attributeName="d" to="M1 1z"/></path>', { code: 'svg_forbidden_element', element: 'animate' }],
    ['a set', '<use href="#a"><set attributeName="href" to="javascript:alert(1)"/></use>', { code: 'svg_forbidden_element', element: 'set' }],
    ['an element of another namespace', '<x:thing xmlns:x="urn:x"/>', { code: 'svg_forbidden_element', element: 'x:thing' }],
    ['inline style', '<path style="fill:red" d="M0 0z"/>', { code: 'svg_forbidden_attribute', element: 'path', attribute: 'style' }],
    ['an event handler', '<path onclick="alert(1)" d="M0 0z"/>', { code: 'svg_forbidden_attribute', element: 'path', attribute: 'onclick' }],
    ['a class', '<path class="a" d="M0 0z"/>', { code: 'svg_forbidden_attribute', element: 'path', attribute: 'class' }],
    ['an external href', '<use href="https://evil.example/s.svg#a"/>', { code: 'svg_external_reference', element: 'use', attribute: 'href' }],
    ['a javascript href', '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(1)"/>', { code: 'svg_external_reference', element: 'use', attribute: 'xlink:href' }],
    ['an external url()', '<path fill="url(https://evil.example/p.svg#g)" d="M0 0z"/>', { code: 'svg_external_reference', element: 'path', attribute: 'fill' }],
  ])('refuses %s, naming what to remove', (_, body, violation) => {
    expect(violations(svg(body))).toEqual([violation]);
  });

  it('refuses an onload on the root element', () => {
    expect(violations(svg('', 'viewBox="0 0 24 24" onload="alert(1)"'))).toEqual([
      { code: 'svg_forbidden_attribute', element: 'svg', attribute: 'onload' },
    ]);
  });

  it.each([
    ['declares a DOCTYPE', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 'svg_doctype_not_allowed'],
    [
      'declares entities',
      '<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>&b;</title></svg>',
      'svg_doctype_not_allowed',
    ],
    ['reads an external entity', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', 'svg_doctype_not_allowed'],
    ['has no viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>', 'svg_missing_viewbox'],
    ['has an empty viewBox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 24"/>', 'svg_missing_viewbox'],
    ['is not well-formed', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path></svg>', 'svg_unparseable'],
    ['is not SVG', '<html><body/></html>', 'svg_unparseable'],
    ['is an SVG without its namespace', '<svg viewBox="0 0 1 1"/>', 'svg_unparseable'],
    ['is not text', '\u0000\u0001PNG', 'svg_unparseable'],
  ])('refuses a file that %s', (_, file, code) => {
    expect(violations(Buffer.from(file))).toEqual([{ code }]);
  });

  it('refuses a file over the size limit before reading it', () => {
    const padding = '<path d="M0 0z"/>'.repeat(MAX_SVG_ICON_BYTES / 16);

    expect(violations(svg(padding))).toEqual([{ code: 'svg_too_large' }]);
  });

  it('reports each violation once, all of them up to 20, and never their values', () => {
    const distinct = Array.from({ length: 30 }, (_, index) => `<path on${'x'.repeat(index)}="alert('secret')" d="M0 0z"/>`).join('');
    const repeated = '<path style="fill:red" d="M0 0z"/>'.repeat(5);

    expect(violations(svg(repeated + '<script>alert(1)</script>'))).toEqual([
      { code: 'svg_forbidden_attribute', element: 'path', attribute: 'style' },
      { code: 'svg_forbidden_element', element: 'script' },
    ]);
    const capped = violations(svg(distinct));
    expect(capped).toHaveLength(20);
    expect(JSON.stringify(capped)).not.toContain('secret');
  });

  it('trims a long name to 64 characters', () => {
    const name = `on${'x'.repeat(100)}`;

    expect(violations(svg(`<path ${name}="1" d="M0 0z"/>`))).toEqual([
      { code: 'svg_forbidden_attribute', element: 'path', attribute: name.slice(0, 64) },
    ]);
  });
});
