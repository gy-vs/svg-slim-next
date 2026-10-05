import { builtinPlugins } from './builtin.js';
import { encodeSVGDatauri } from './svgo/tools.js';
import { invokePlugins } from './svgo/plugins.js';
import { removeSkipMarkers } from './svgo/skip.js';
import { querySelector, querySelectorAll } from './xast.js';
import { mapNodesToParents } from './util/map-nodes-to-parents.js';
import { parseSvg } from './parser.js';
import { stringifySvg } from './stringifier.js';
import { VERSION } from './version.js';
import * as _collections from '../plugins/_collections.js';

const pluginsMap = new Map();
for (const plugin of builtinPlugins) {
  pluginsMap.set(plugin.name, plugin);
}

/**
 * @param {string} name
 * @returns {import('./types.js').BuiltinPluginOrPreset<?, ?>}
 */
function getPlugin(name) {
  if (name === 'removeScriptElement') {
    console.warn(
      'Warning: removeScriptElement has been renamed to removeScripts, please update your SVGO config',
    );
    return pluginsMap.get('removeScripts');
  }

  return pluginsMap.get(name);
}

/**
 * Resolved plugin configuration as consumed by the plugin engine. Presets
 * additionally carry their nested plugin list.
 *
 * @typedef {import('./types.js').CustomPlugin & { isPreset?: true, plugins?: ReadonlyArray<import('./types.js').BuiltinPlugin<string, any>> }} ResolvedPluginConfig
 */

/**
 * @param {string | import('./types.js').PluginConfig} plugin
 * @returns {?ResolvedPluginConfig}
 */
const resolvePluginConfig = (plugin) => {
  if (typeof plugin === 'string') {
    // resolve builtin plugin specified as string
    const builtinPlugin = getPlugin(plugin);
    if (builtinPlugin == null) {
      throw Error(`Unknown builtin plugin "${plugin}" specified.`);
    }
    /** @type {ResolvedPluginConfig} */
    const stringResolved = {
      name: plugin,
      params: {},
      fn: builtinPlugin.fn,
      isPreset: builtinPlugin.isPreset,
      plugins: builtinPlugin.plugins,
    };
    return stringResolved;
  }
  if (typeof plugin === 'object' && plugin != null) {
    if (plugin.name == null) {
      throw Error(`Plugin name must be specified`);
    }
    // use custom plugin implementation
    // @ts-expect-error Checking for CustomPlugin with the presence of fn
    let fn = plugin.fn;
    /** @type {import('./types.js').BuiltinPluginOrPreset<?, ?> | undefined} */
    let builtinPlugin;
    if (fn == null) {
      // resolve builtin plugin implementation
      builtinPlugin = getPlugin(plugin.name);
      if (builtinPlugin == null) {
        throw Error(`Unknown builtin plugin "${plugin.name}" specified.`);
      }
      fn = builtinPlugin.fn;
    }
    /** @type {ResolvedPluginConfig} */
    const objectResolved = {
      name: plugin.name,
      params: plugin.params,
      fn,
      isPreset: builtinPlugin?.isPreset,
      plugins: builtinPlugin?.plugins,
    };
    return objectResolved;
  }
  return null;
};

export * from './types.js';

/**
 * The core of SVGO.
 *
 * @param {string} input
 * @param {import('./types.js').Config=} config
 * @returns {import('./types.js').Output}
 */
export const optimize = (input, config) => {
  if (config == null) {
    config = {};
  }
  if (typeof config !== 'object') {
    throw Error('Config should be an object');
  }
  const maxPassCount = config.multipass ? 10 : 1;
  let prevResultSize = Number.POSITIVE_INFINITY;
  let output = '';
  let lastAst = null;
  let lastRunHadMarkers = false;
  /** @type {Set<string>} */
  const warnedSkipPluginNames = new Set();
  const info = {};
  if (config.path != null) {
    info.path = config.path;
  }
  for (let i = 0; i < maxPassCount; i += 1) {
    info.multipassCount = i;
    const ast = parseSvg(input, config.path);
    const plugins = config.plugins || ['preset-default'];
    if (!Array.isArray(plugins)) {
      throw Error(
        'malformed config, `plugins` property must be an array.\nSee more info here: #configuration',
      );
    }
    const resolvedPlugins = plugins
      .filter((plugin) => plugin != null)
      .map(resolvePluginConfig);

    if (resolvedPlugins.length < plugins.length) {
      console.warn(
        'Warning: plugins list includes null or undefined elements, these will be ignored.',
      );
    }

    /** @type {import('./types.js').Config} */
    const globalOverrides = {};
    if (config.floatPrecision != null) {
      globalOverrides.floatPrecision = config.floatPrecision;
    }
    // skip markers are kept between passes so every pass honors them, and
    // stripped only from the final result
    lastRunHadMarkers = invokePlugins(
      ast,
      info,
      resolvedPlugins,
      null,
      globalOverrides,
      undefined,
      true,
      warnedSkipPluginNames,
    );
    lastAst = ast;
    output = stringifySvg(ast, config.js2svg);
    if (output.length < prevResultSize) {
      input = output;
      prevResultSize = output.length;
    } else {
      break;
    }
  }
  if (lastAst != null && lastRunHadMarkers) {
    removeSkipMarkers(lastAst);
    output = stringifySvg(lastAst, config.js2svg);
  }
  if (config.datauri) {
    output = encodeSVGDatauri(output, config.datauri);
  }
  return {
    data: output,
  };
};

export {
  VERSION,
  builtinPlugins,
  mapNodesToParents,
  querySelector,
  querySelectorAll,
  _collections,
};
