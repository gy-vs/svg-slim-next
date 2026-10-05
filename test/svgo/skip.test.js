import { jest } from '@jest/globals';
import { optimize } from '../../lib/svgo.js';

/**
 * Element level opt-out via `data-svgo-skip` attribute and `svgo-skip-next`
 * comment.
 */
describe('svgo skip markers', () => {
  it('skips all plugins with an empty attribute value', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" fill="#FF0000"/><path d="M2 2L3 3" fill="#FF0000" data-svgo-skip=""/></svg>`;
    const result = optimize(svg);
    // the first path is optimized, the second stays verbatim and unmerged
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="red" d="m0 0 1 1"/><path d="M2 2L3 3" fill="#FF0000"/></svg>`,
    );
  });

  it('skips all plugins with an empty comment directive', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><!-- svgo-skip-next --><path d="M2 2L3 3" fill="#FF0000"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="M2 2L3 3" fill="#FF0000"/></svg>`,
    );
  });

  it('skips only the listed plugins with an attribute', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" fill="#FF0000"/><path d="M2 2L3 3" fill="#FF0000" data-svgo-skip="mergePaths"/></svg>`;
    const result = optimize(svg);
    // colors still converted and path data still rewritten, but no merging
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="red" d="m0 0 1 1"/><path fill="red" d="m2 2 1 1"/></svg>`,
    );
  });

  it('skips only the listed plugins with a comment directive', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><!-- svgo-skip-next convertColors --><path d="M2 2L3 3" fill="#AABBCC"/></svg>`;
    const result = optimize(svg);
    // path data optimized, the hex value is preserved verbatim
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#AABBCC" d="m2 2 1 1"/></svg>`,
    );
  });

  it('keeps surrounding elements optimized', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000" width="10" height="10"/><rect fill="#00ff00" width="10" height="10" data-svgo-skip=""/><rect fill="#0000ff" width="10" height="10"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="red" d="M0 0h10v10H0z"/><rect fill="#00ff00" width="10" height="10"/><path fill="#00f" d="M0 0h10v10H0z"/></svg>`,
    );
  });

  it('protects the whole subtree of the marked element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g data-svgo-skip=""><rect width="1.00" height="1.00" fill="#FF0000"/><path d="M0 0L1 1L2 2L3 3"/></g></svg>`;
    const result = optimize(svg);
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1.00" height="1.00" fill="#FF0000"/><path d="M0 0L1 1L2 2L3 3"/></g></svg>`,
    );
  });

  it('cannot be merged with adjacent paths', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" fill="#ff0000"/><path d="M2 2L3 3" fill="#ff0000" data-svgo-skip="mergePaths"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toContain(`<path fill="red" d="m2 2 1 1"/>`);
    expect(result.data).not.toContain('M2 2l1 1');
  });

  it('cannot be collapsed by collapseGroups', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g data-svgo-skip="collapseGroups" data-motion="fade"><rect width="1" height="1"/></g></svg>`;
    const result = optimize(svg);
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><g data-motion="fade"><path d="M0 0h1v1H0z"/></g></svg>`,
    );
  });

  it('cannot have parent group attributes moved onto it', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g fill="#ff0000"><rect width="1" height="1"/><rect width="1" height="1" data-svgo-skip="moveElemsAttrsToGroup"/></g></svg>`;
    const result = optimize(svg);
    // when the common fill is moved from the children to the group, it is
    // deleted on both children; with the second child protected the move
    // cannot happen, so no move related output appears
    expect(result.data).toContain('<g fill="red">');
    expect(result.data).not.toContain('<path fill="red"');
  });

  it('cannot have styles inlined onto it', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#ff0000}</style><rect class="a"/><rect class="a" data-svgo-skip="inlineStyles"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toContain('<rect class="a"/>');
  });

  it('keeps its id untouched by cleanupIds', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs><rect fill="url(#a)"/><rect id="brand" data-svgo-skip="cleanupIds"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toContain('id="brand"');
  });

  it('keeps references inside a fully protected subtree verbatim', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect data-svgo-skip="" fill="url(#longGradientName)"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toContain('fill="url(#longGradientName)"');
  });

  it('removes the marker attribute from the output', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect data-svgo-skip=""/></svg>`;
    const result = optimize(svg);
    expect(result.data).not.toContain('data-svgo-skip');
  });

  it('removes the directive comment from the output', () => {
    const withRemoveComments = `<svg xmlns="http://www.w3.org/2000/svg"><!-- svgo-skip-next --><rect/></svg>`;
    expect(optimize(withRemoveComments).data).not.toContain('svgo-skip');

    // also without removeComments in the plugin list
    const noPlugins = `<svg><!-- svgo-skip-next --><rect data-foo="1"/></svg>`;
    expect(optimize(noPlugins, { plugins: [] }).data).toBe(
      `<svg><rect data-foo="1"/></svg>`,
    );
  });

  it('honors the markers on every multipass iteration', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><!-- svgo-skip-next convertColors --><path fill="#AABBCC" d="M0 0L1 1L2 2L3 3"/></svg>`;
    const result = optimize(svg, { multipass: true });
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#AABBCC" d="m0 0 1 1 1 1 1 1"/></svg>`,
    );

    const attrSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1" fill="#FF0000"/><path d="M2 2L3 3" fill="#FF0000" data-svgo-skip=""/></svg>`;
    const attrResult = optimize(attrSvg, { multipass: true });
    expect(attrResult.data).toContain(`<path d="M2 2L3 3" fill="#FF0000"/>`);
  });

  it('combines attribute and directive plugin lists on one element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><!-- svgo-skip-next convertPathData --><path fill="#FF0000" data-svgo-skip="convertColors" d="M0 0L1 1L2 2L3 3"/></svg>`;
    const result = optimize(svg);
    // color and path data preserved by the two combined skip lists
    expect(result.data).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#FF0000" d="M0 0L1 1L2 2L3 3"/></svg>`,
    );
  });

  it('does not treat a non-adjacent comment as a directive', () => {
    const svg = `<svg><!-- svgo-skip-next --><!-- other --><rect fill="#ff0000"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toContain('fill="red"');
  });

  it('warns about unknown plugin names without throwing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = `<svg><rect fill="#ff0000" data-svgo-skip="totallyBogus convertColors"/></svg>`;
    const result = optimize(svg);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown plugin "totallyBogus"'),
    );
    // the valid name still applies
    expect(result.data).toContain('fill="#ff0000"');
    warn.mockRestore();
  });

  it('warns once per unknown name', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svg = `<svg><rect data-svgo-skip="bogus"/><rect data-svgo-skip="bogus"/></svg>`;
    optimize(svg, { multipass: true });
    expect(
      warn.mock.calls.filter(([msg]) => String(msg).includes('"bogus"')),
    ).toHaveLength(1);
    warn.mockRestore();
  });

  it('works for custom plugins without code changes', () => {
    const customPlugin = {
      name: 'customTagger',
      fn: () => ({
        element: {
          /** @param {import('../../lib/types.js').XastElement} node */
          enter: (node) => {
            node.attributes['data-custom'] = 'x';
            if (node.name === 'rect') {
              node.name = 'RECT';
            }
          },
        },
      }),
    };
    const svg = `<svg><rect/><rect data-svgo-skip=""/></svg>`;
    const result = optimize(svg, { plugins: [customPlugin] });
    expect(result.data).toBe(
      `<svg data-custom="x"><RECT data-custom="x"/><rect/></svg>`,
    );
  });

  it('works for custom plugins walking the tree manually', () => {
    const customPlugin = {
      name: 'customWalker',
      fn: () => ({
        root: {
          /** @param {import('../../lib/types.js').XastRoot} root */
          enter: (root) => {
            /** @param {import('../../lib/types.js').XastNode} node */
            const walk = (node) => {
              if (node.type === 'element') {
                node.attributes['data-w'] = '1';
              }
              if (node.type === 'root' || node.type === 'element') {
                for (const child of node.children) {
                  walk(child);
                }
              }
            };
            walk(root);
          },
        },
      }),
    };
    const svg = `<svg><g data-svgo-skip=""><rect/></g><rect/></svg>`;
    const result = optimize(svg, { plugins: [customPlugin] });
    expect(result.data).toBe(
      `<svg data-w="1"><g><rect/></g><rect data-w="1"/></svg>`,
    );
  });

  it('skips custom plugins listed by name', () => {
    const customPlugin = {
      name: 'customRenamer',
      fn: () => ({
        element: {
          /** @param {import('../../lib/types.js').XastElement} node */
          enter: (node) => {
            if (node.name === 'rect') {
              node.name = 'RECT';
            }
          },
        },
      }),
    };
    const svg = `<svg><rect/><rect data-svgo-skip="customRenamer"/></svg>`;
    const result = optimize(svg, { plugins: [customPlugin] });
    expect(result.data).toBe(`<svg><RECT/><rect/></svg>`);
  });

  it('protects the root svg element itself', () => {
    const svg = `<svg data-svgo-skip="" viewBox="0 0 10 10"><rect fill="#ff0000"/></svg>`;
    const result = optimize(svg);
    expect(result.data).toBe(
      `<svg viewBox="0 0 10 10"><rect fill="#ff0000"/></svg>`,
    );
  });
});
