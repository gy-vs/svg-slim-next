import { visit } from '../util/visit.js';
import {
  collectReferencedIdsInSubtrees,
  detachSkippedNodes,
  reattachSkippedNodes,
  removeLeftoverPlaceholders,
} from './skip.js';

/**
 * Property under which the skip state is attached to the plugin info object
 * so preset plugins can access the state of the engine invocation they run
 * inside of.
 */
export const skipStateSymbol = Symbol('skipState');

/**
 * Plugins engine.
 *
 * @module plugins
 *
 * @param {import('../types.js').XastNode} ast Input AST.
 * @param {any} info Extra information.
 * @param {ReadonlyArray<any>} plugins Plugins property from config.
 * @param {any} overrides
 * @param {any} globalOverrides
 */
export const invokePlugins = (
  ast,
  info,
  plugins,
  overrides,
  globalOverrides,
) => {
  /**
   * @type {import('./skip.js').SkipState | undefined}
   */
  const skipState = /** @type {any} */ (info)?.[skipStateSymbol];
  for (const plugin of plugins) {
    const override = overrides?.[plugin.name];
    if (override === false) {
      continue;
    }
    const params = { ...plugin.params, ...globalOverrides, ...override };

    /** @type {import('./skip.js').DetachedSubtree[]} */
    let detached = [];
    // presets are containers that invoke their own plugins; the detachment
    // and reattachment is performed around each leaf plugin instead
    if (skipState != null && ast.type === 'root' && plugin.isPreset !== true) {
      skipState.pluginNames.add(plugin.name);
      detached = detachSkippedNodes(
        /** @type {import('../types.js').XastRoot} */ (ast),
        skipState.directives,
        plugin.name,
      );
    }

    let effectiveParams = params;
    if (detached.length !== 0 && plugin.name === 'cleanupIds') {
      // IDs referenced from protected subtrees must not be renamed or removed
      const referencedIds = collectReferencedIdsInSubtrees(detached);
      if (referencedIds.size !== 0) {
        const preserve = params.preserve ?? [];
        effectiveParams = {
          ...params,
          preserve: [
            ...(Array.isArray(preserve) ? preserve : [preserve]),
            ...referencedIds,
          ],
        };
      }
    }

    try {
      const visitor = plugin.fn(ast, effectiveParams, info);
      if (visitor != null) {
        visit(ast, visitor);
      }
    } finally {
      if (detached.length !== 0) {
        reattachSkippedNodes(
          /** @type {import('../types.js').XastRoot} */ (ast),
          detached,
        );
        removeLeftoverPlaceholders(
          /** @type {import('../types.js').XastRoot} */ (ast),
        );
      }
    }
  }
};

/**
 * @template {`preset-${string}`} T
 * @param {{ name: T, plugins: ReadonlyArray<import('../types.js').BuiltinPlugin<string, any>> }} arg0
 * @returns {import('../types.js').BuiltinPluginOrPreset<T, any>}
 */
export const createPreset = ({ name, plugins }) => {
  return {
    name,
    isPreset: true,
    plugins: Object.freeze(plugins),
    fn: (ast, params, info) => {
      const { floatPrecision, overrides } = params;
      const globalOverrides = {};
      if (floatPrecision != null) {
        globalOverrides.floatPrecision = floatPrecision;
      }
      if (overrides) {
        const pluginNames = plugins.map(({ name }) => name);
        for (const pluginName of Object.keys(overrides)) {
          if (!pluginNames.includes(pluginName)) {
            console.warn(
              `You are trying to configure ${pluginName} which is not part of ${name}.\n` +
                `Try to put it before or after, for example\n\n` +
                `plugins: [\n` +
                `  {\n` +
                `    name: '${name}',\n` +
                `  },\n` +
                `  '${pluginName}'\n` +
                `]\n`,
            );
          }
        }
      }
      invokePlugins(ast, info, plugins, overrides, globalOverrides);
    },
  };
};
