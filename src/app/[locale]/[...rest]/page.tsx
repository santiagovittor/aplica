import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

/**
 * SLICE-25 §C: the route that makes `[locale]/not-found.tsx` reachable.
 *
 * A URL that matches no route at all falls through to the *root* not-found,
 * which renders outside `[locale]/layout.tsx` -- no shell, no wordmark, no
 * messages, no tokens. `[locale]/not-found.tsx` is only reached by a
 * `notFound()` thrown from inside the locale segment, and nothing was throwing
 * one. This catch-all claims every unclaimed path under a locale and throws
 * from in there, which is next-intl's own documented answer to the same
 * problem.
 *
 * It cannot shadow a real route: Next matches static segments before dynamic
 * ones and dynamic before catch-alls, so `/es/account` still reaches
 * `account/page.tsx`. `notFound()` sets the 404 status itself, so a wrong URL
 * still answers 404 rather than 200 with an apology on it.
 *
 * `setRequestLocale` before the throw, so whatever renders next has a locale to
 * translate against. This page never renders anything of its own.
 */
export default async function CatchAll({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}
