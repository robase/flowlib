import path from 'node:path';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { getSlugs } from 'fumadocs-core/source';
import { printErrors, readFiles, scanURLs, validateFiles } from 'next-validate-link';

async function checkLinks() {
  const docsFiles = await readFiles('content/docs/**/*.{md,mdx}');

  const scanned = await scanURLs({
    preset: 'next',
    populate: {
      'docs/[[...slug]]': docsFiles.map((file) => {
        return {
          value: getSlugs(path.relative('content/docs', file.path)),
          hashes: getTableOfContents(file.content).map((item) => item.url.slice(1)),
        };
      }),
    },
  });

  printErrors(
    await validateFiles(docsFiles, {
      scanned,
      markdown: {
        components: {
          Card: { attributes: ['href'] },
        },
      },
      checkRelativePaths: 'as-url',
    }),
    true,
  );
}

void checkLinks();
