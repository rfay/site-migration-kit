# Getting the content into a new Drupal site: two valid ways

The kit's tests do not care how the content got into the new site. They only check the result against the
baseline taken from the original. So the way you move the data is your choice, and **both of these are valid**.
Pick the one that costs less for the site in front of you.

## 1. Drupal's Migrate API

Describe each step in YAML (users, files, terms, nodes, comments), and run them with `drush migrate:import`.

- **Good for:** steps you can rerun and roll back; a reviewable, declarative record; sites whose source is
  Drupal 6 or 7, where core already ships the source plugins (`d6_*`, `d7_*`). If the stock plugins work, this
  is the cheapest path.
- **Cost:** more files to write when the source is not a standard one; the learning curve of process plugins.
- **Watch for:** a source that only looks standard. A Backdrop database resembles Drupal 7, but its field,
  vocabulary and text-format definitions live in config files, so the stock Drupal 7 source plugins find nothing.

## 2. A rerunnable script

One PHP script (run with `drush php:script`) that reads a copy of the source database and creates the new
entities, keeping the original ids so URLs and aliases keep working.

- **Good for:** small sites, odd sources, and live demos. It is short, it reads top to bottom, and an AI
  assistant can write and fix it quickly. It is the approach used for randyfay.com
  (`randyfay-d11/scripts/20-import.php`: 126 nodes, 670 comments, 33 files in about 8 seconds).
- **Make it safe to repeat:** begin by deleting what an earlier run imported, then import everything again.
- **Cost:** no built-in rollback or status tracking, and a bigger site makes it harder to review.

## How to choose

| Question | Lean towards |
|---|---|
| Is the source a standard Drupal 6 or 7 site? | Migrate API |
| Is it a nonstandard source (Backdrop, a custom schema, a CMS from elsewhere)? | Script |
| Will people run it for months, in stages, with rollbacks? | Migrate API |
| Is it one cutover and a few hundred items? | Script |

A tedious chain of Drupal-to-Drupal upgrades (7 to 8 to 9 to 10 to 11) is not needed in either approach: both
read the source database directly and write the new site once.

Either way: take the source from a **copy** of the database (never the live one), keep the new site's
configuration in git, record what you decided and why, and let the shared test suite say when you are done.
