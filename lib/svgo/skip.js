import { detachNodeFromParent } from '../xast.js';
import { findReferences } from './tools.js';

/**
 * Per-element plugin opt-out support.
 *
 * Elements can be protected from specific plugins, or from every plugin,
 * either with an attribute or with a directive comment:
 *
 * - `data-svgo-skip` attribute on the element. An empty value protects the
 *   element (and all its descendants) from every plugin, a space separated
 *   list of plugin names protects it only from the listed plugins.
 * - A `<!-- svgo-skip-next -->` comment placed right before the element, with
 *   the same optional list of plugin names after the directive.
 *
 * The markers themselves are removed from the final output.
 *
 * @module svgo/skip
 */

export const SKIP_ATTRIBUTE = 'data-svgo-skip';
export const SKIP_COMMENT = 'svgo-skip-next';

const SKIP_PLACEHOLDER = 'svgo-skip-placeholder';

const regDirective = /^svgo-skip-next(?:\s+(.*))?\s*$/s;

/**
 * @param {string} value
 * @returns {?string} The part of the comment following the directive, or null
 *   if the comment is not a skip directive.
 */
const matchDirectiveComment = (value) => {
  const match = value.trim().match(regDirective);
  return match == null ? null : (match[1] ?? '');
};

/**
 * Directive parsed for one element: a set of plugin names to protect the
 * element from. An empty set means protection from every plugin.
 *
 * @typedef {{ all: boolean, names: Set<string> }} SkipDirective
 */

/**
 * Find the directive comment immediately preceding an element, ignoring
 * whitespace text nodes in between.
 *
 * @param {import('../types.js').XastParent} parent
 * @param {number} index
 * @returns {{ node: import('../types.js').XastComment, value: string } | null}
 */
const findPrecedingDirective = (parent, index) => {
  let i = index - 1;
  while (i >= 0) {
    const sibling = parent.children[i];
    if (sibling.type === 'text' && sibling.value.trim() === '') {
      i -= 1;
      continue;
    }
    if (sibling.type === 'comment') {
      const value = matchDirectiveComment(sibling.value);
      if (value != null) {
        return { node: sibling, value };
      }
    }
    return null;
  }
  return null;
};

/**
 * @param {string} value
 * @returns {SkipDirective}
 */
const parseDirectiveValue = (value) => {
  const names = value.split(/\s+/).filter(Boolean);
  return { all: names.length === 0, names: new Set(names) };
};

/**
 * Collect all skip directives from the tree: converts directive comments into
 * element directives, removes the comments and maps every protected element
 * (including descendants inheriting an "all plugins" directive) to the set of
 * plugin names it must be protected from.
 *
 * @param {import('../types.js').XastRoot} ast
 * @returns {{
 *   directives: Map<import('../types.js').XastElement, SkipDirective>,
 *   markedElements: Map<import('../types.js').XastElement, string>,
 *   hasMarkers: boolean,
 * }}
 */
export const collectSkipDirectives = (ast) => {
  /** @type {Map<import('../types.js').XastElement, SkipDirective>} */
  const directives = new Map();
  /**
   * Elements carrying an explicit marker (attribute or directive comment),
   * mapped to the marker value, so it can be restored in intermediate output.
   *
   * @type {Map<import('../types.js').XastElement, string>}
   */
  const markedElements = new Map();
  let hasMarkers = false;

  /**
   * @param {import('../types.js').XastParent} parent
   * @param {boolean} inheritedAll
   */
  const walk = (parent, inheritedAll) => {
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i];
      if (node.type !== 'element') {
        continue;
      }

      /** @type {boolean} */
      let ownAll = false;
      /** @type {Set<string>} */
      let ownNames = new Set();
      let marked = false;

      const comment = findPrecedingDirective(parent, i);
      if (comment != null) {
        hasMarkers = true;
        marked = true;
        const commentDirective = parseDirectiveValue(comment.value);
        ownAll = commentDirective.all;
        ownNames = commentDirective.names;
        detachNodeFromParent(comment.node, parent);
        i -= 1;
      }

      if (node.attributes[SKIP_ATTRIBUTE] != null) {
        hasMarkers = true;
        marked = true;
        const attributeDirective = parseDirectiveValue(
          node.attributes[SKIP_ATTRIBUTE],
        );
        ownAll = ownAll || attributeDirective.all;
        ownNames = new Set([...ownNames, ...attributeDirective.names]);
      }

      const all = ownAll || inheritedAll;
      // only "all plugins" directives are inherited by descendants
      if (all || ownNames.size !== 0) {
        directives.set(node, { all, names: ownNames });
      }
      if (marked) {
        markedElements.set(node, ownAll ? '' : [...ownNames].join(' '));
      }

      walk(node, all);
    }
  };

  walk(ast, false);
  return { directives, markedElements, hasMarkers };
};

/**
 * Check whether an element is protected from the given plugin, taking
 * inherited directives into account.
 *
 * @param {Map<import('../types.js').XastElement, SkipDirective>} directives
 * @param {import('../types.js').XastElement} node
 * @param {string} pluginName
 * @returns {boolean}
 */
export const isSkippedForPlugin = (directives, node, pluginName) => {
  const directive = directives.get(node);
  if (directive == null) {
    return false;
  }
  return directive.all || directive.names.has(pluginName);
};

/**
 * State of the per-element skip directives for one run of the plugins
 * engine, shared with preset plugins nested in it.
 *
 * @typedef {object} SkipState
 * @property {Map<import('../types.js').XastElement, SkipDirective>} directives
 * @property {Set<string>} pluginNames Names of plugins enabled in this run.
 * @property {Set<string>} warned Plugin names a warning was already emitted for.
 */

/**
 * Warn (once per run) about plugin names used in skip directives that do not
 * match any plugin enabled in the current configuration.
 *
 * @param {SkipState} state
 */
export const warnUnknownSkippedPlugins = (state) => {
  for (const directive of state.directives.values()) {
    for (const name of directive.names) {
      if (!state.pluginNames.has(name) && !state.warned.has(name)) {
        state.warned.add(name);
        console.warn(
          `Warning: skip directive refers to unknown plugin "${name}", it will be ignored.`,
        );
      }
    }
  }
};

/**
 * A protected subtree detached for the duration of one plugin run.
 *
 * @typedef {object} DetachedSubtree
 * @property {object} node
 * @property {import('../types.js').XastParent} parent
 * @property {number} index
 * @property {?object} prevSibling
 * @property {?object} nextSibling
 * @property {object} placeholder
 * @property {ReadonlyArray<import('../types.js').XastParent>} ancestors
 */

/**
 * Detach all top-level subtrees protected from the plugin, replacing them
 * with opaque placeholder nodes so the running plugin cannot see, modify or
 * consume the protected elements.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {Map<import('../types.js').XastElement, SkipDirective>} directives
 * @param {string} pluginName
 * @returns {DetachedSubtree[]}
 */
export const detachSkippedNodes = (ast, directives, pluginName) => {
  /** @type {DetachedSubtree[]} */
  const detached = [];

  /**
   * @param {import('../types.js').XastParent} parent
   * @param {import('../types.js').XastParent[]} ancestors
   */
  const walk = (parent, ancestors) => {
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i];
      if (node.type !== 'element') {
        continue;
      }
      if (isSkippedForPlugin(directives, node, pluginName)) {
        const placeholder = { type: SKIP_PLACEHOLDER };
        detached.push({
          node,
          parent,
          index: i,
          prevSibling: parent.children[i - 1] ?? null,
          nextSibling: parent.children[i + 1] ?? null,
          placeholder,
          ancestors,
        });
        parent.children.splice(i, 1, /** @type {any} */ (placeholder));
        // do not descend into the protected subtree
        continue;
      }
      walk(node, [parent, ...ancestors]);
    }
  };

  walk(ast, []);
  return detached;
};

/**
 * Reinsert all detached subtrees, replacing their placeholders. Falls back to
 * a position next to a known sibling or the original parent if the structure
 * around the placeholder was changed by the plugin.
 *
 * @param {import('../types.js').XastRoot} ast
 * @param {DetachedSubtree[]} detached
 */
export const reattachSkippedNodes = (ast, detached) => {
  /**
   * Build a map of every node to its current parent. Placeholder nodes are
   * plain objects, so the map is intentionally untyped here.
   *
   * @type {Map<object, import('../types.js').XastParent>}
   */
  const parents = new Map();
  /** @param {import('../types.js').XastParent} parent */
  const mapParents = (parent) => {
    for (const child of parent.children) {
      parents.set(child, parent);
      if (child.type === 'element') {
        mapParents(child);
      }
    }
  };
  mapParents(ast);

  for (const item of detached) {
    const { node, parent, ancestors, prevSibling, nextSibling, placeholder } =
      item;

    /**
     * @param {import('../types.js').XastParent} targetParent
     * @param {number} targetIndex
     * @param {boolean} replace Whether to replace the node at the index
     *   (the placeholder) or insert before it (a surviving anchor).
     */
    const insert = (targetParent, targetIndex, replace) => {
      targetParent.children.splice(
        targetIndex,
        replace ? 1 : 0,
        /** @type {any} */ (node),
      );
      parents.set(/** @type {any} */ (node), targetParent);
    };

    const placeholderParent = parents.get(placeholder);
    if (placeholderParent != null) {
      const placeholderIndex = placeholderParent.children.indexOf(
        /** @type {any} */ (placeholder),
      );
      insert(placeholderParent, placeholderIndex, true);
      continue;
    }
    // the placeholder itself was removed; insert next to a surviving sibling
    if (prevSibling != null) {
      const anchorParent = parents.get(prevSibling);
      if (anchorParent != null) {
        insert(
          anchorParent,
          anchorParent.children.indexOf(/** @type {any} */ (prevSibling)) + 1,
          false,
        );
        continue;
      }
    }
    if (nextSibling != null) {
      const anchorParent = parents.get(nextSibling);
      if (anchorParent != null) {
        insert(
          anchorParent,
          anchorParent.children.indexOf(/** @type {any} */ (nextSibling)),
          false,
        );
        continue;
      }
    }

    // no anchor survived either; the original parent may have been removed
    // together with the placeholder. Walk up the original ancestor chain,
    // recorded before the plugin ran, until a parent still in the tree.
    /** @type {import('../types.js').XastParent} */
    let fallbackParent = parent;
    if (!parents.has(parent)) {
      fallbackParent = ast;
      for (const ancestor of ancestors) {
        if (parents.has(ancestor)) {
          fallbackParent = ancestor;
          break;
        }
      }
    }
    insert(fallbackParent, fallbackParent.children.length, false);
  }
};

/**
 * Remove any placeholders left in the tree. Normally every placeholder is
 * replaced by {@link reattachSkippedNodes}, this is a safety net.
 *
 * @param {import('../types.js').XastRoot} ast
 */
export const removeLeftoverPlaceholders = (ast) => {
  /** @param {import('../types.js').XastParent} parent */
  const walk = (parent) => {
    const children = /** @type {any[]} */ (parent.children);
    parent.children = children.filter(
      (child) => child.type !== SKIP_PLACEHOLDER,
    );
    for (const child of parent.children) {
      if (child.type === 'element') {
        walk(child);
      }
    }
  };
  walk(ast);
};

/**
 * Collect every ID referenced from the given (detached) subtrees. Plugins
 * renaming or removing IDs cannot see detached subtrees, so references found
 * inside them must still keep the referenced IDs intact.
 *
 * @param {ReadonlyArray<DetachedSubtree>} detached
 * @returns {Set<string>}
 */
export const collectReferencedIdsInSubtrees = (detached) => {
  /** @type {Set<string>} */
  const ids = new Set();

  /** @param {import('../types.js').XastElement} element */
  const walk = (element) => {
    for (const [name, value] of Object.entries(element.attributes)) {
      for (const id of findReferences(name, value)) {
        ids.add(id);
      }
    }
    for (const child of element.children) {
      if (child.type === 'element') {
        walk(child);
      }
    }
  };

  for (const item of detached) {
    const node = /** @type {import('../types.js').XastElement} */ (item.node);
    if (node.type === 'element') {
      walk(node);
    }
  }
  return ids;
};

/**
 * Restore the skip attribute on marked elements, used to keep the directives
 * working when the intermediate result is parsed again during multipass.
 *
 * @param {Map<import('../types.js').XastElement, string>} markedElements
 */
export const restoreSkipAttributes = (markedElements) => {
  for (const [node, value] of markedElements) {
    node.attributes[SKIP_ATTRIBUTE] = value;
  }
};

/**
 * Remove the skip attribute from every element, called on the final result
 * before stringifying.
 *
 * @param {import('../types.js').XastRoot} ast
 */
export const removeSkipAttributes = (ast) => {
  /** @param {import('../types.js').XastParent} parent */
  const walk = (parent) => {
    for (const child of parent.children) {
      if (child.type === 'element') {
        delete child.attributes[SKIP_ATTRIBUTE];
        walk(child);
      }
    }
  };
  walk(ast);
};
