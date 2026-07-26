-- The init migration creates the cvs bucket with `on conflict (id) do nothing`,
-- which is right on a fresh project and silently wrong on any project where a
-- bucket named `cvs` already existed: the insert becomes a no-op and the bucket
-- keeps whatever visibility it had. A pre-existing public bucket would leave
-- every uploaded CV readable over the public route with no token, which is the
-- one thing PROJECT.md section 6 says must never be true.
--
-- The insert asserted nothing. This asserts the property instead, and is safe to
-- re-run.
update storage.buckets
   set public = false
 where id = 'cvs'
   and public is distinct from false;
