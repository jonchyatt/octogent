import { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({
  breaks: true,
  gfm: true,
});

type MarkdownContentProps = {
  content: string;
  className?: string;
};

export const MarkdownContent = ({ content, className }: MarkdownContentProps) => {
  const html = useMemo(() => {
    return marked.parse(content, { async: false }) as string;
  }, [content]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
