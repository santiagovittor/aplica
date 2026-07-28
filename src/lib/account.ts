import { z } from 'zod';
import { supabaseRequest } from './supabase';

/**
 * Deleting an account, and everything it owns (SLICE-9 decision 7).
 *
 * One function, one documented order: storage objects first (`cvs`, then
 * `outputs`), then the `auth.users` delete that cascades `public.users`,
 * `profiles`, `api_keys`, `applications` and `usage_counters`.
 *
 * The order is not cosmetic. Storage has no foreign key to cascade through, so
 * deleting the auth user first would strand the files permanently with no row
 * left to find them from. If a storage delete fails, this throws and the
 * account survives: a live account with its files is a recoverable state, and a
 * deleted account with unreachable files is not.
 */

/** One page of a storage listing. A folder comes back with a null id. */
const Listing = z.array(
  z.object({ name: z.string(), id: z.string().nullable() }),
);

/** The API's own ceiling for one `list` call. */
const PAGE_SIZE = 100;

export async function deleteAccount(userId: string): Promise<void> {
  // Straight into a storage prefix and a URL path, so it is a UUID or it is
  // nothing. A prefix that is not a user id would reach another person's files.
  const owner = z.uuid().parse(userId);

  await emptyFolder('cvs', owner);
  await emptyFolder('outputs', owner);

  // Everything in Postgres goes with this one, through the cascade the init
  // migration wired from auth.users down.
  await supabaseRequest('account delete', `/auth/v1/admin/users/${owner}`, {
    method: 'DELETE',
  });
}

/** Lists a folder to the bottom, then deletes every object in one request. */
async function emptyFolder(bucket: string, prefix: string): Promise<void> {
  const paths = await listObjects(bucket, prefix);
  if (paths.length === 0) {
    // An empty `prefixes` array is a request that can only fail.
    return;
  }

  await supabaseRequest(`${bucket} delete`, `/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
}

/**
 * Every object under a prefix, at any depth.
 *
 * `list` does not recurse: it returns the objects directly under the prefix
 * plus one entry per subfolder, and a subfolder has a null id. `outputs` is
 * keyed <uid>/<application>/<file>, so a single flat call there returns
 * folders, and a delete built from that list would remove nothing while looking
 * like it worked.
 */
async function listObjects(bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await supabaseRequest(
      `${bucket} list`,
      `/storage/v1/object/list/${bucket}`,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix, limit: PAGE_SIZE, offset }),
      },
    );

    const page = Listing.parse(await response.json());

    for (const entry of page) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        paths.push(...(await listObjects(bucket, path)));
      } else {
        paths.push(path);
      }
    }

    if (page.length < PAGE_SIZE) {
      return paths;
    }
  }
}
