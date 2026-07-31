/**
 * Swaps the leading locale segment of a path this app generated, for the auth
 * callback route's "the account's stored locale wins over what `next`
 * carries" redirect (SLICE-11 decision 7). Every `next` that reaches it is
 * either the callback route's own `/${locale}/...` fallback or a `next` built
 * by `callbackUrl` in `(auth)/actions.ts`, and both always carry one, so this
 * is a rewrite of a known shape rather than a general parser.
 *
 * Its own file, with no imports: `callback/route.ts` pulls in `@/lib/session`,
 * which reaches `next-intl`'s client navigation entry and cannot load under
 * plain Node (only Next's own bundler resolves it), so this one pure function
 * would otherwise be untestable without standing up a full Next test
 * environment for the sake of a one-line string rewrite.
 */
export function withLocale(path: string, locale: string): string {
  const segments = path.split('/');
  segments[1] = locale;
  return segments.join('/');
}
