// What declares `import heroImage from '../../public/hero-1.png'` to be a
// `StaticImageData` rather than a missing module.
//
// Next generates that reference into `next-env.d.ts`, which is gitignored (it
// also imports `.next/types/routes.d.ts`, a build artefact, so committing it
// would trade one missing module for another). CI runs `tsc --noEmit` on a
// clean checkout before it ever runs `next build`, so on CI the generated file
// does not exist and every static image import is an error. This file is the
// one line of it that source code depends on, checked in.
/// <reference types="next/image-types/global" />
