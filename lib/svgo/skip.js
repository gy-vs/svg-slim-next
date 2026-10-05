import { mapNodesToParents } from '../util/map-nodes-to-parents.js';
import { visit } from '../util/visit.js';

/**
 * Element-level opt-out for plugins.
 *
 * Two equivalent markers are supported inside an SVG:
 *
 * 1. A `data-svgo-skip` attribute on an element. An empty value skips every
 *    plugin; a whitespace separated list of plugin names skips only those
 *    plugins, for example
 *
 *        <path d="..." data-svgo-skip="mergePaths convertColors"/>
 *
 * 2. A `svgo-skip-next` comment directly before an element, optionally
 *    followed by plugin names:
 *
 *        <!-- svgo-skip-next mergePaths -->
 *        <path d="..."/>
 *
 * @module svgo/skip
 */

export const skipAttribute = 'data-svgo-skip';
const skipComment = 'svgo-skip-next';

/**
 * @typedef {Map<import('../types.js').XastElement, Set<string> | null>} SkipMap
 *
 * Element -> skipped plugin names. A `null` value means all plugins are
 * skipped; an empty set means the marker referenced only unknown plugins and
 * therefore protects nothing.
 */

/**
 * Placeholder node left in the tree while a plugin is running. The protected
 * subtree is detached together with the placeholder, and restored afterwards.
 *
 * An empty `<g>` with an id is used:
 * - as an element it blocks sibling based transforms (e.g. path merging),
 *   which a comment would not;
 * - `g` is not a shape, so shape conversion and path data plugins ignore it;
 * - the id blocks group attribute propagation and removal of empty/useless
 *   containers.
 *
 * The id is generated per invocation and never leaves the plugin run.
 *
 * @returns {import('../types.js').XastElement}
 */
let placeholderCounter = 0;
const createPlaceholder = () => {
  placeholderCounter += 1;
  /** @type {import('../types.js').XastElement} */
  const placeholder = {
    type: 'element',
    name: 'g',
    attributes: { id: `svgo-skip-placeholder-${placeholderCounter}` },
    children: [],
  };
  return placeholder;
};

/**
 * Replace comment directives with the equivalent attribute on the next
 * element, collect skip markers, warn about referenced plugin names that do
 * not exist and return a map of protected elements.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {ReadonlyArray<string>} pluginNames All plugin names about to run
 *   (including plugins nested in presets).
 * @param {Set<string>=} warnedNames Names already warned about, shared across
 *   multipass iterations.
 * @returns {SkipMap}
 */
export const collectSkipMarkers = (
  ast,
  pluginNames,
  warnedNames = new Set(),
) => {
  /** @type {SkipMap} */
  const skipMap = new Map();

  /**
   * @param {string | null | undefined} raw
   * @returns {Set<string> | null}
   */
  const parseNames = (raw) => {
    const names = (raw ?? '').split(/\s+/).filter(Boolean);
    if (names.length === 0) {
      return null;
    }
    const result = new Set();
    for (const name of names) {
      if (!pluginNames.includes(name)) {
        if (!warnedNames.has(name)) {
          warnedNames.add(name);
          console.warn(
            `Warning: unknown plugin "${name}" in ${skipAttribute} skip list, ignoring it.`,
          );
        }
        continue;
      }
      result.add(name);
    }
    // all the listed names were unknown, the marker protects nothing
    return result;
  };

  /**
   * @param {import('../types.js').XastElement} element
   * @param {Set<string> | null} names
   */
  const addProtection = (element, names) => {
    const existing = skipMap.get(element);
    if (existing == null) {
      skipMap.set(element, names);
    } else if (names == null) {
      skipMap.set(element, null);
    } else if (existing !== null) {
      for (const name of names) {
        existing.add(name);
      }
    }
  };

  visit(ast, {
    element: {
      enter: (element, parentNode) => {
        if (element.attributes[skipAttribute] != null) {
          addProtection(element, parseNames(element.attributes[skipAttribute]));
        }
        // translate a directly preceding comment directive into the
        // attribute and drop the comment itself: the attribute keeps the
        // protection alive across multipass re-parses
        if (parentNode.type === 'root' || parentNode.type === 'element') {
          const index = parentNode.children.indexOf(element);
          const previous = parentNode.children[index - 1];
          if (previous?.type === 'comment') {
            const match = previous.value
              .trim()
              .match(new RegExp(`^${skipComment}(?:\\s+(.*))?$`));
            if (match != null) {
              const commentNames = parseNames(match[1]);
              addProtection(element, commentNames);
              const merged = new Set(
                (element.attributes[skipAttribute] ?? '')
                  .split(/\s+/)
                  .filter(Boolean),
              );
              if (commentNames === null) {
                // empty comment directive skips every plugin
                element.attributes[skipAttribute] =
                  element.attributes[skipAttribute] ?? '';
              } else {
                for (const name of commentNames) {
                  merged.add(name);
                }
                element.attributes[skipAttribute] = [...merged].join(' ');
              }
              parentNode.children.splice(index - 1, 1);
            }
          }
        }
      },
    },
  });

  return skipMap;
};

/**
 * Remove the `data-svgo-skip` attributes and `svgo-skip-next` comments once
 * all passes are done.
 *
 * @param {import('../types.js').XastRoot} ast
 */
export const removeSkipMarkers = (ast) => {
  visit(ast, {
    element: {
      enter: (element) => {
        delete element.attributes[skipAttribute];
      },
    },
    comment: {
      enter: (comment, parentNode) => {
        if (new RegExp(`^${skipComment}(?:\\s|$)`).test(comment.value.trim())) {
          parentNode.children = parentNode.children.filter(
            (child) => child !== comment,
          );
        }
      },
    },
  });
};

/**
 * @param {import('../types.js').XastRoot} root
 * @param {import('../types.js').XastNode} node
 * @returns {boolean}
 */
const isAttached = (root, node) => {
  if (node === root) {
    return true;
  }
  let found = false;
  visit(root, {
    element: {
      enter: (element) => {
        if (element === node) {
          found = true;
        }
      },
    },
  });
  return found;
};

/**
 * Detach all elements protected from `pluginName`, replacing each one with a
 * comment placeholder. Returns the detached subtrees and the recorded
 * positions needed to restore them.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {SkipMap} skipMap
 * @param {string} pluginName
 * @returns {{ detached: Array<{ parent: import('../types.js').XastParent, index: number, placeholder: import('../types.js').XastElement, subtree: import('../types.js').XastElement }>, parents: Map<import('../types.js').XastNode, import('../types.js').XastParent> }}
 */
const detachProtectedElements = (ast, skipMap, pluginName) => {
  const parents = mapNodesToParents(ast);
  /**
   * @type {Array<{ parent: import('../types.js').XastParent, index: number, placeholder: import('../types.js').XastElement, subtree: import('../types.js').XastElement }>}
   */
  const detached = [];

  visit(ast, {
    element: {
      enter: (element, parentNode) => {
        const names = skipMap.get(element);
        if (names === undefined) {
          return;
        }
        // null means all plugins are skipped; an empty set means the marker
        // only referenced unknown plugin names and protects nothing
        if (names !== null && !names.has(pluginName)) {
          return;
        }
        // elements inside an already detached subtree are not reached by the
        // traversal; the outer subtree carries them through untouched
        const index = parentNode.children.indexOf(element);
        if (index === -1) {
          return;
        }
        const placeholder = createPlaceholder();
        parentNode.children.splice(index, 1, placeholder);
        detached.push({
          parent: parentNode,
          index,
          placeholder,
          subtree: element,
        });
      },
    },
  });

  return { detached, parents };
};

/**
 * Put the detached subtrees back where their placeholders are. If a plugin
 * removed the placeholder (e.g. removeComments), reinsert at the recorded
 * position; if the recorded parent itself disappeared, reattach to the
 * closest surviving ancestor.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {Array<{ parent: import('../types.js').XastParent, index: number, placeholder: import('../types.js').XastElement, subtree: import('../types.js').XastElement }>} detached
 * @param {Map<import('../types.js').XastNode, import('../types.js').XastParent>} parents
 */
const restoreProtectedElements = (ast, detached, parents) => {
  for (const { parent, index, placeholder, subtree } of detached) {
    const placeholderIndex = parent.children.indexOf(placeholder);
    if (placeholderIndex !== -1) {
      parent.children.splice(placeholderIndex, 1, subtree);
      continue;
    }

    // the placeholder itself was removed
    if (isAttached(ast, parent)) {
      parent.children.splice(
        Math.min(index, parent.children.length),
        0,
        subtree,
      );
      continue;
    }

    // the recorded parent disappeared as well, keep the protected subtree on
    // the closest ancestor still present in the tree
    /** @type {import('../types.js').XastNode} */
    let ancestor = parent;
    while (ancestor !== ast && !isAttached(ast, ancestor)) {
      const next = parents.get(ancestor);
      if (next == null) {
        break;
      }
      ancestor = next;
    }
    if (ancestor.type === 'root' || ancestor.type === 'element') {
      ancestor.children.push(subtree);
    }
  }
};

/**
 * Internal context passed to plugin functions (4th argument); used by presets
 * to share the skip state of the surrounding plugin list.
 *
 * @typedef {{ skipMap: SkipMap, warnedNames: Set<string> }} SkipContext
 */

/**
 * Whether at least one element is protected from `pluginName`.
 *
 * @param {SkipMap} skipMap
 * @param {string} pluginName
 * @returns {boolean}
 */
const hasProtection = (skipMap, pluginName) => {
  for (const names of skipMap.values()) {
    if (names === null || names.has(pluginName)) {
      return true;
    }
  }
  return false;
};

/**
 * Run a single plugin with protected subtrees out of reach.
 *
 * Protected subtrees are physically detached (replaced with an inert
 * placeholder) before the plugin function is invoked and restored afterwards.
 * This makes the protection effective for every kind of plugin code: visitors
 * returned from `fn`, manual traversals performed inside `fn`, and sibling
 * based transforms that could otherwise use protected nodes as material.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {SkipMap} skipMap
 * @param {{ name: string, fn: Function, params: any, plugins?: ReadonlyArray<any> }} plugin
 * @param {any} info
 * @param {SkipContext} internalContext
 * @param {(ast: import('../types.js').XastRoot, visitor: any) => void} runVisitor
 */
export const invokePluginWithSkip = (
  ast,
  skipMap,
  plugin,
  info,
  internalContext,
  runVisitor,
) => {
  // a preset runs its own leaf plugins, each of which detaches/restores on
  // its own; detaching around the preset as well would nest placeholders
  if (Array.isArray(plugin.plugins)) {
    const visitor = plugin.fn(ast, plugin.params, info, internalContext);
    if (visitor != null) {
      runVisitor(ast, visitor);
    }
    return;
  }
  // fast path: no element opts out of this plugin
  if (!hasProtection(skipMap, plugin.name)) {
    const visitor = plugin.fn(ast, plugin.params, info);
    if (visitor != null) {
      runVisitor(ast, visitor);
    }
    return;
  }
  const { detached, parents } = detachProtectedElements(
    ast,
    skipMap,
    plugin.name,
  );
  try {
    const visitor = plugin.fn(ast, plugin.params, info);
    if (visitor != null) {
      runVisitor(ast, visitor);
    }
  } finally {
    restoreProtectedElements(ast, detached, parents);
  }
};
