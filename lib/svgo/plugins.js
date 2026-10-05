import { visit } from '../util/visit.js';
import {
  collectSkipMarkers,
  invokePluginWithSkip,
  removeSkipMarkers,
} from './skip.js';

/**
 * @typedef {import('./skip.js').SkipMap} SkipMap
 */

/**
 * Plugins engine.
 *
 * @module plugins
 *
 * @param {import('../types.js').XastRoot} ast Input AST.
 * @param {any} info Extra information.
 * @param {ReadonlyArray<any>} plugins Plugins property from config.
 * @param {any} overrides
 * @param {any} globalOverrides
 * @param {SkipMap=} inheritedSkipMap Skip map already collected by an outer
 *   invokePlugins call (when running inside a preset).
 * @param {boolean=} keepMarkers Keep skip attributes after running, so they
 *   survive between multipass iterations.
 * @param {Set<string>=} warnedNames Unknown plugin names already reported.
 * @returns {boolean} Whether the input contained any skip markers.
 */
export const invokePlugins = (
  ast,
  info,
  plugins,
  overrides,
  globalOverrides,
  inheritedSkipMap,
  keepMarkers = false,
  warnedNames = new Set(),
) => {
  const enabledPlugins = plugins.filter((plugin) => {
    const override = overrides?.[plugin.name];
    return override !== false;
  });
  const skipMap =
    inheritedSkipMap ??
    collectSkipMarkers(
      ast,
      enabledPlugins.flatMap(flattenPluginNames),
      warnedNames,
    );
  for (const plugin of enabledPlugins) {
    const override = overrides?.[plugin.name];
    const params = { ...plugin.params, ...globalOverrides, ...override };
    invokePluginWithSkip(
      ast,
      skipMap,
      {
        name: plugin.name,
        fn: plugin.fn,
        params,
        plugins: plugin.plugins,
      },
      info,
      { skipMap, warnedNames },
      visit,
    );
  }
  if (inheritedSkipMap == null && !keepMarkers) {
    removeSkipMarkers(ast);
  }
  return skipMap.size > 0;
};

/**
 * Preset plugins run their own list of plugins; names of nested plugins have
 * to be known so skip lists can reference them.
 *
 * @param {{ name: string, plugins?: ReadonlyArray<{ name: string }> }} plugin
 * @returns {string[]}
 */
const flattenPluginNames = (plugin) => {
  if (Array.isArray(plugin.plugins)) {
    return [plugin.name, ...plugin.plugins.map(({ name }) => name)];
  }
  return [plugin.name];
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
    /**
     * @param {import('../types.js').XastRoot} ast
     * @param {any} params
     * @param {import('../types.js').PluginInfo} info
     * @param {import('./skip.js').SkipContext=} internalContext
     */
    fn: (ast, params, info, internalContext) => {
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
      invokePlugins(
        ast,
        info,
        plugins,
        overrides,
        globalOverrides,
        internalContext?.skipMap,
        false,
        internalContext?.warnedNames,
      );
    },
  };
};
