import { registerHooks } from 'node:module';

/**
 * Lets `node` run the app's own TypeScript modules unchanged.
 *
 * Node strips types on its own, but it does not rewrite import specifiers, and
 * everything in `src/` imports its neighbours the way a bundler expects:
 * without a file extension. This appends the one Node needs, so a script can
 * import the real modules instead of a copy of them.
 *
 * Plain JavaScript on purpose: `registerHooks` arrived in Node 22.15 and the
 * pinned @types/node is older, so declaring it in TypeScript would mean either
 * a cast or a repo-wide types bump. Neither belongs in a dev script.
 *
 * Wired into the `parse:cv` script in package.json, which also asks Node to
 * transform rather than only strip: `src/` uses constructor parameter
 * properties, which strip-only mode refuses.
 */
registerHooks({
  resolve(specifier, context, next) {
    // Our own modules only. A dependency's own extensionless requires are
    // JavaScript and resolve on their own: unicode-trie, which arrives under
    // @react-pdf/renderer, does `require('./swap')` and every one of these
    // turned that into a missing `./swap.ts`.
    const ours =
      context.parentURL !== undefined &&
      !context.parentURL.includes('/node_modules/');
    const bare = specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier);
    return next(ours && bare ? `${specifier}.ts` : specifier, context);
  },
});
