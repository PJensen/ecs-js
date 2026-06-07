// ecs/extensions.js
// Runtime extension definitions and World appendage methods.

/**
 * Define a named runtime extension for a World.
 *
 * Extensions are runtime-only capabilities. They may register listeners,
 * adapters, diagnostics, or other world-local behavior, and may return a
 * synchronous cleanup function.
 * @param {string} name
 * @param {(world:any)=>(void|Function)} installer
 * @param {{ key?: any }} [options]
 * @returns {{ key:any, name:string, install:(world:any)=>(void|Function) }}
 */
export function defineExtension(name, installer, options = {}) {
  if (typeof name !== 'string' || !name) {
    throw new Error('defineExtension: name must be a non-empty string');
  }
  if (typeof installer !== 'function') {
    throw new Error('defineExtension: installer must be a function');
  }
  const key = Object.prototype.hasOwnProperty.call(options, 'key')
    ? options.key
    : Symbol(name);
  return Object.freeze({ key, name, install: installer });
}

export function isExtensionLike(extension) {
  return typeof extension === 'function' || !!(extension && typeof extension === 'object' && typeof extension.install === 'function');
}

export function installWorldExtensionAPI(WorldCtor, options = {}) {
  const logError = typeof options.logError === 'function' ? options.logError : () => {};

  Object.assign(WorldCtor.prototype, {
    /** Attach a runtime extension once.
     * @param {Function|{ key?:any, name?:string, install:(world:any)=>(void|Function) }} extension
     * @returns {any}
     */
    install(extension) {
      const key = extensionKey(extension, 'install');
      if (this._extensions.has(key)) return this;

      const name = extensionName(extension);
      let cleanup = null;
      try {
        const result = runExtensionInstaller(extension, this);
        cleanup = typeof result === 'function' ? result : null;
      } catch (e) {
        logError(`[ecs] extension "${name}" failed to install`, e);
        throw e;
      }

      this._extensions.set(key, {
        key,
        name,
        extension,
        uninstall: cleanup
      });
      return this;
    },

    /** Remove a runtime extension, invoking its cleanup if one was returned.
     * @param {Function|{ key?:any, name?:string, install?:Function }} extension
     * @returns {boolean}
     */
    uninstall(extension) {
      const key = extensionKey(extension, 'uninstall');
      const rec = this._extensions.get(key);
      if (!rec) return false;

      this._extensions.delete(key);
      if (typeof rec.uninstall === 'function') {
        try {
          rec.uninstall(this);
        } catch (e) {
          logError(`[ecs] extension "${rec.name}" uninstall failed`, e);
        }
      }
      return true;
    },

    /** Check whether a runtime extension is attached.
     * @param {Function|{ key?:any }} extension
     * @returns {boolean}
     */
    hasExtension(extension) {
      return this._extensions.has(extensionKey(extension, 'hasExtension'));
    },

    /** Return diagnostic records for attached runtime extensions.
     * @returns {Array<{ name:string, key:any, extension:any, uninstallable:boolean }>}
     */
    extensions() {
      return Array.from(this._extensions.values()).map(rec => ({
        name: rec.name,
        key: rec.key,
        extension: rec.extension,
        uninstallable: typeof rec.uninstall === 'function'
      }));
    }
  });
}

function extensionKey(extension, label = 'install') {
  if (!extension) throw new Error(`${label}: extension required`);
  if (typeof extension === 'function') return extension;
  if (typeof extension === 'object') {
    if (Object.prototype.hasOwnProperty.call(extension, 'key')) return extension.key;
    return extension;
  }
  throw new Error(`${label}: expected function or extension object`);
}

function extensionName(extension) {
  if (typeof extension === 'function') return extension.name || '<anonymous extension>';
  if (extension && typeof extension === 'object') return String(extension.name || '<anonymous extension>');
  return '<invalid extension>';
}

function runExtensionInstaller(extension, world) {
  if (typeof extension === 'function') return extension(world);
  if (extension && typeof extension.install === 'function') return extension.install(world);
  throw new Error('install: expected function or object with install(world)');
}
