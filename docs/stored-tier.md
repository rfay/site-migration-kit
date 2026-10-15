# The stored-content tier

*Part of [how-it-works.md](how-it-works.md). Built on hobobiker.com (Drupal 6).*

## The problem it solves

Every other tier compares **what a visitor sees**. That's the right default, and it has one blind spot:
content that is **stored but never shown**. On hobobiker.com:

- 447 comments, none visible: the comment module is disabled.
- 85 published nodes whose module is gone (photo albums, image nodes), which render as a title and
  nothing else.
- 18 unpublished book pages, a whole country-by-country guide.

The render-based baseline records none of this, because none of it renders. A static archive may
legitimately leave it behind. A CMS rebuild is different: dropping every comment would pass every
other tier, and nobody would know until someone went looking.

## How it works

1. **An exporter reads the source database** and writes raw records: nodes (current revision, any
   status), comments and taxonomy terms. `lib/stored.mjs` turns them into a comparable form: each
   body or comment becomes text lines (markup ignored, stored PHP kept as text), and each record keeps
   its source ID.
2. **The output is frozen** as `baseline/stored.json`, next to the other baselines.
3. **For a target**, an exporter for the *target's* platform produces the same raw shape, mapping each
   record back to its source ID (`sourceNid`, `sourceCid`). The Migrate API's map tables give this
   directly; a migration script must record it.
4. **The suite compares** in the same one-directional way as the semantic tier. Every baseline node
   must exist with the same title and published status, and every line of its stored body must
   appear. Every comment must exist on the same node with its subject and text. Every term must exist.
   Extra content on the target is fine.

**It fails only for the targets in `config.stored.enforceFor`** (default `['drupal11']`). For any
other target, every difference is reported as an annotation and the test passes. With no
`STORED_TARGET_EXPORT`, the tier is skipped, except for an enforced target, where a missing export is
a failure: it must never read as a pass.

## Running it

```bash
# Freeze (host side: the exporter uses `ddev mysql`)
node kit/scripts/stored-exporters/drupal6.mjs

# Self-check: export the original again and compare, enforced
node kit/scripts/stored-exporters/drupal6.mjs --out tmp/stored-now.json
ddev exec -d /var/www/html/test/playwright \
  'STORED_TARGET_EXPORT=tmp/stored-now.json MIGRATION_TARGET=drupal11 npx playwright test --grep "stored:"'
```

Site wrapper, `tests/stored.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../migration.config.mjs';
import { registerStoredSuite } from '../kit/tests/stored-suite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerStoredSuite({ test, expect, config, root });
```

Tags: `@stored`, `@stored-<type>`, `@comments` (one test per comment thread), `@draft` (unpublished).

## Writing an exporter for another platform

Copy `scripts/stored-exporters/drupal6.mjs`. Only the queries change. Produce:

```js
{ platform, nodes: [{ sourceNid, type, published, title, created, bodyHtml }],
  comments: [{ sourceCid, sourceNid, published, subject, name, created, commentHtml }],
  terms: [{ vocabulary, name }] }
```

and pass it through `buildStored()`. Watch the platform's conventions: in Drupal 6
`comments.status = 0` means *published*, the reverse of `node.status`.

## Measured on hobobiker.com

| What | Result |
|---|---|
| Export | 2 s: 1,296 nodes, 447 comments, 82 terms; 1.5 MB |
| Self-check, enforced | 1,445 pass in 5 s |
| Negative control: one comment dropped, one title changed | drupal11: 2 failures naming both ("comment 1163 on node 4123 by Javier Martin is missing"); static: reported, passes |

## Lessons

- **An HTML parser silently drops `<?php ... ?>`** (it reads it as a processing instruction). The first
  export recorded node 4196 without the `tripinfo_table()` call that *is* its stored body.
  `textLines()` escapes PHP into text first.
- Body lines, not hashes: a failure names the missing sentence, which a reviewer can act on.
