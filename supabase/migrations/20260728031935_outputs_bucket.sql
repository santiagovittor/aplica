-- Rendered application files (PROJECT.md section 5, flow 3). The init migration
-- creates exactly one bucket, `cvs`, which holds what the user uploaded; these
-- are what the product produced, they have a different owner and a different
-- write path, and mixing the two would mean one policy governing both.
--
-- Objects are keyed <user_id>/<application_id>/<file>, so `storage.foldername`'s
-- first segment is the owner and the policy below reads it the same way the
-- `cvs` policy does. The application id is minted in TypeScript with
-- crypto.randomUUID() and passed as an explicit `id` on the insert: waiting for
-- gen_random_uuid() to mint it would mean insert, read back, upload, update,
-- which is three round trips and a half-written row whenever an upload fails.
-- Supplying the id keeps saveProfile's documented file-then-row order.

-- `on conflict do update`, not `do nothing`. The init migration's `do nothing`
-- was silently wrong on any project where a bucket of that name already
-- existed: the insert became a no-op and the bucket kept whatever visibility it
-- had, and 20260726184046 had to go back and assert it. This asserts the
-- property on the first write instead, and is safe to re-run.
insert into storage.buckets (id, name, public)
values ('outputs', 'outputs', false)
on conflict (id) do update set public = false;

-- Select only, unlike `cvs` which is `for all`.
--
-- The server writes these with the secret key, which bypasses row-level
-- security, so the owner never needs insert, update or delete to get a file
-- here. A client that could write to this bucket could replace a rendered
-- resume with anything at all, and the applications list would serve it
-- happily. Where a table or bucket has no policy for an action, that action is
-- impossible for anon and authenticated, which is the whole point of writing
-- only the one policy that is needed.
create policy "outputs owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- The shape `saveApplication` writes, documented where `profiles.data` is.
-- `kind` and `format` are the render seam's own union types; `path` is the key
-- in the `outputs` bucket above and always begins with the owner's id.
comment on column public.applications.files is
  'Rendered files for this application, written by saveApplication in src/lib/supabase.ts. An array of {kind, format, path, bytes}, where kind is "resume" or "cover-letter", format is "pdf" or "docx", path is the object key in the private outputs bucket (<user_id>/<application_id>/<file>), and bytes is the byte length. Example: [{"kind":"resume","format":"pdf","path":"<uid>/<app>/resume.pdf","bytes":41234}]. The tier decides the count: basic 1, standard 2, full 4 (PROJECT.md section 9).';

-- Known and deliberately not solved here (SLICE-7, "Not built"): deleting an
-- application, or deleting an account, cascades the row and leaves these
-- objects behind. Storage has no foreign key to cascade through. That cleanup
-- is step 9's, and it is named here because this migration is what creates the
-- orphan.
