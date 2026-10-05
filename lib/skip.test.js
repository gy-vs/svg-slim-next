import { jest } from '@jest/globals';
import { optimize } from './svgo.js';

describe('per-element skip directive', () => {
  test('empty attribute protects the element from every plugin', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <path d="M0 0 L10 10" fill="#FF0000"/>
      </g>
      <path d="M0 0 L10 10" fill="#0000FF"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <g>
    <path d="M0 0 L10 10" fill="#FF0000"/>
  </g>
  <path fill="#00f" d="m0 0 10 10"/>
</svg>
"
`);
  });

  test('attribute with plugin names protects only from those plugins', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="convertColors" d="M0 0 L10 10" fill="#FF0000"/>
      <path d="M20 20 L30 30" fill="#0000FF"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <path fill="#FF0000" d="m0 0 10 10"/>
  <path fill="#00f" d="m20 20 10 10"/>
</svg>
"
`);
  });

  test('directive comment without names protects from every plugin', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- svgo-skip-next -->
      <path d="M0 0 L10 10" fill="#FF0000"/>
      <path d="M20 20 L30 30" fill="#0000FF"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 L10 10" fill="#FF0000"/>
  <path fill="#00f" d="m20 20 10 10"/>
</svg>
"
`);
  });

  test('directive comment with plugin names', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- svgo-skip-next convertColors -->
      <path d="M0 0 L10 10" fill="#FF0000"/>
      <path d="M20 20 L30 30" fill="#0000FF"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <path fill="#FF0000" d="m0 0 10 10"/>
  <path fill="#00f" d="m20 20 10 10"/>
</svg>
"
`);
  });

  test('directive comment can be separated from the element by whitespace', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- svgo-skip-next -->

      <path d="M0 0 L10 10" fill="#FF0000"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#FF0000"');
    expect(data).not.toContain('svgo-skip');
  });

  test('empty directive is inherited by all descendants', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <g fill="#AABBCC">
          <path fill="#DDEEFF" d="M0 0L1 1"/>
        </g>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#AABBCC"');
    expect(data).toContain('fill="#DDEEFF"');
    expect(data).toContain('d="M0 0L1 1"');
  });

  test('named directive protects the element and its subtree', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="convertColors" fill="#FF0000">
        <path fill="#0000FF" d="M0 0L1 1"/>
        <path fill="#FFFF00" d="M2 2L3 3"/>
      </g>
      <path fill="#00FF00" d="M4 4L5 5"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    // the named plugin cannot see the element or its descendants
    expect(data).toContain('fill="#FF0000"');
    expect(data).toContain('fill="#0000FF"');
    expect(data).toContain('fill="#FFFF00"');
    // elements outside the protected subtree are optimized normally
    expect(data).toContain('fill="#0f0"');
    // other plugins still apply inside the subtree
    expect(data).not.toContain('d="M0 0L1 1"');
  });

  test('attribute and comment on the same element combine', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- svgo-skip-next convertColors -->
      <path data-svgo-skip="convertPathData" d="M0 0 L10 10" fill="#FF0000"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#FF0000"');
    expect(data).toContain('d="M0 0 L10 10"');
  });
});

describe('protected nodes cannot be consumed by other plugins', () => {
  test('mergePaths cannot merge a protected path with a neighbour', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g>
        <path d="M0 0L10 10"/>
        <path data-svgo-skip="" d="M20 20L30 30"/>
        <path d="M40 40L50 50"/>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['mergePaths'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <g>
    <path d="M0 0L10 10"/>
    <path d="M20 20L30 30"/>
    <path d="M40 40L50 50"/>
  </g>
</svg>
"
`);
  });

  test('mergePaths still merges neighbours on both sides independently', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g>
        <path d="M0 0L10 10"/>
        <path data-svgo-skip="" d="M20 20L30 30"/>
        <path d="M40 40L50 50"/>
        <path d="M60 60L70 70"/>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['mergePaths'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('d="M0 0L10 10"');
    expect(data).toContain('d="M20 20L30 30"');
    // mergePaths joins the two unprotected paths, the protected one stays
    expect(data).toContain('M40 40 50 50M60 60 70 70');
  });

  test('collapseGroups does not collapse a protected group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g>
        <g data-svgo-skip="" fill="red">
          <path d="M0 0L10 10"/>
        </g>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['collapseGroups'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('<g fill="red">');
    expect(data).toContain('<path d="M0 0L10 10"/>');
  });

  test('collapseGroups does not move parent attributes onto a protected child', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g fill="red">
        <path data-svgo-skip="" d="M0 0L10 10"/>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['collapseGroups'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('<g fill="red">');
    expect(data).not.toContain('<path fill="red"');
  });

  test('cleanupIds does not change the id of a protected element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="" id="my-very-long-identifier" d="M0 0L1 1"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['cleanupIds'],
    });
    expect(data).toContain('id="my-very-long-identifier"');
  });

  test('cleanupIds keeps IDs referenced from a protected subtree intact', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="my-gradient">
          <stop offset="0"/>
        </linearGradient>
      </defs>
      <g data-svgo-skip="">
        <circle fill="url(#my-gradient)"/>
      </g>
      <circle fill="url(#my-gradient)"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
    });
    // the id is not minified, so neither reference can dangle
    expect(data).toContain('id="my-gradient"');
    expect(data).toContain('fill="url(#my-gradient)"');
    expect(data).not.toContain('url(#a)');
  });

  test('inlineStyles does not write style onto a protected element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>.a { fill: red }</style>
      <path data-svgo-skip="" class="a" d="M0 0L1 1"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['inlineStyles'],
    });
    expect(data).not.toContain('style=');
    expect(data).toContain('class="a"');
  });

  test('nodes outside the protected subtree are optimized normally', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <path d="M0 0 L10 10" fill="#FF0000"/>
      </g>
      <g>
        <path d="M20 20 L30 30" fill="#0000FF"/>
      </g>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#FF0000"');
    expect(data).toContain('d="M0 0 L10 10"');
    expect(data).toContain('fill="#00f"');
  });

  test('marking the root svg protects the whole document', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-svgo-skip="">
      <path d="M0 0 L10 10" fill="#FF0000"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#FF0000"');
    expect(data).toContain('d="M0 0 L10 10"');
    expect(data).not.toContain('data-svgo-skip');
  });

  test('comments inside a protected subtree are not removed', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <!-- keep this comment -->
        <path d="M0 0L1 1"/>
      </g>
    </svg>`;
    const { data } = optimize(svg, { plugins: ['preset-default'] });
    expect(data).toContain('keep this comment');
  });
});

describe('custom plugins', () => {
  test('custom plugin does not see protected nodes without any changes', () => {
    /** @type {string[]} */
    const seen = [];
    /** @type {import('./svgo.js').CustomPlugin} */
    const customPlugin = {
      name: 'testCustomPlugin',
      fn: () => ({
        element: {
          enter: (node) => {
            seen.push(`${node.name}:${node.attributes.d ?? ''}`);
            node.attributes['data-touched'] = '1';
          },
        },
      }),
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <path d="M0 0L1 1"/>
      </g>
      <path d="M2 2L3 3"/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: [customPlugin],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(seen).toStrictEqual(['svg:', 'path:M2 2L3 3']);
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg" data-touched="1">
  <g>
    <path d="M0 0L1 1"/>
  </g>
  <path d="M2 2L3 3" data-touched="1"/>
</svg>
"
`);
  });

  test('custom plugin removing the placeholder keeps the protected node', () => {
    /** @type {import('./svgo.js').CustomPlugin} */
    const hostilePlugin = {
      name: 'hostilePlugin',
      fn: () => ({
        element: {
          enter: (node) => {
            // keeps only elements and text, dropping any unknown node types
            node.children = node.children.filter(
              (child) => child.type === 'element' || child.type === 'text',
            );
          },
        },
      }),
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <a/>
      <g data-svgo-skip=""><path d="M0 0L1 1"/></g>
      <b/>
    </svg>`;
    const { data } = optimize(svg, {
      plugins: [hostilePlugin],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toMatchInlineSnapshot(`
"<svg xmlns="http://www.w3.org/2000/svg">
  <a/>
  <g>
    <path d="M0 0L1 1"/>
  </g>
  <b/>
</svg>
"
`);
  });
});

describe('markers are removed from the output', () => {
  test('attribute marker is removed', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="" d="M0 0L1 1"/>
    </svg>`;
    const { data } = optimize(svg, { plugins: ['preset-default'] });
    expect(data).not.toContain('data-svgo-skip');
  });

  test('named attribute marker is removed', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="convertColors" fill="#FF0000" d="M0 0L1 1"/>
    </svg>`;
    const { data } = optimize(svg, { plugins: ['preset-default'] });
    expect(data).not.toContain('data-svgo-skip');
  });

  test('comment marker is removed', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- svgo-skip-next -->
      <path d="M0 0L1 1" fill="#FF0000"/>
      <!-- ordinary comment -->
    </svg>`;
    const { data } = optimize(svg, { plugins: ['preset-default'] });
    expect(data).not.toContain('svgo-skip');
    expect(data).not.toContain('ordinary comment');
  });

  test('other comments are still handled by removeComments', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <!-- keep me not -->
      <path d="M0 0L1 1" fill="#FF0000"/>
    </svg>`;
    const { data } = optimize(svg, { plugins: ['preset-default'] });
    expect(data).not.toContain('keep me not');
  });
});

describe('multipass', () => {
  test('directives are respected on every pass and stripped at the end', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g data-svgo-skip="">
        <path d="M0 0 L10 10" fill="#FF0000"/>
      </g>
      <path d="M0 0 L10 10" fill="#0000FF"/>
    </svg>`;
    const { data } = optimize(svg, {
      multipass: true,
      plugins: ['preset-default'],
      js2svg: { pretty: true, indent: 2 },
    });
    expect(data).toContain('fill="#FF0000"');
    expect(data).toContain('d="M0 0 L10 10"');
    expect(data).toContain('fill="#00f"');
    expect(data).not.toContain('data-svgo-skip');
  });

  test('directives survive even when a custom plugin removes the attribute', () => {
    /** @type {import('./svgo.js').CustomPlugin} */
    const stripDataAttrs = {
      name: 'stripDataAttrs',
      fn: () => ({
        element: {
          enter: (node) => {
            for (const name of Object.keys(node.attributes)) {
              if (name.startsWith('data-')) {
                delete node.attributes[name];
              }
            }
          },
        },
      }),
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="" id="protected-id" d="M0 0L1 1"/>
    </svg>`;
    const { data } = optimize(svg, {
      multipass: true,
      plugins: [stripDataAttrs, 'cleanupIds'],
    });
    expect(data).toContain('id="protected-id"');
    expect(data).not.toContain('data-svgo-skip');
  });
});

describe('unknown plugin names', () => {
  test('warns instead of throwing on a typo', () => {
    const warn = jest.spyOn(console, 'warn');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="mergePathz" d="M0 0L1 1"/>
    </svg>`;
    expect(() => optimize(svg, { plugins: ['preset-default'] })).not.toThrow();
    expect(warn).toBeCalledWith(
      expect.stringContaining('unknown plugin "mergePathz"'),
    );
    warn.mockRestore();
  });

  test('warns only once per plugin name', () => {
    const warn = jest.spyOn(console, 'warn');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="mergePathz" d="M0 0L1 1"/>
      <path data-svgo-skip="mergePathz convertColorz" d="M2 2L3 3"/>
    </svg>`;
    optimize(svg, { plugins: ['preset-default'] });
    const matching = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown plugin'),
    );
    expect(matching).toHaveLength(2);
    warn.mockRestore();
  });

  test('valid plugin names produce no warning', () => {
    const warn = jest.spyOn(console, 'warn');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <path data-svgo-skip="mergePaths convertColors" d="M0 0L1 1"/>
    </svg>`;
    optimize(svg, { plugins: ['preset-default'] });
    const matching = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unknown plugin'),
    );
    expect(matching).toHaveLength(0);
    warn.mockRestore();
  });
});
