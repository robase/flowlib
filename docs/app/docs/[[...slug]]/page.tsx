import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { LLMCopyButton } from '@/components/llm-copy-button';
import { ViewOptions } from '@/components/view-options';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    notFound();
  }

  const MDX = page.data.body;
  const slugPath = params.slug?.join('/') ?? '';
  const markdownUrl = `/llms-md${slugPath ? `/${slugPath}` : ''}`;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-4">
        <LLMCopyButton markdownUrl={markdownUrl} />
        <ViewOptions
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/robase/flowlib/blob/main/docs/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
