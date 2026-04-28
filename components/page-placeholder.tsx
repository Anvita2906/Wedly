interface PagePlaceholderProps {
  title: string;
}

export function PagePlaceholder({ title }: PagePlaceholderProps) {
  return (
    <section className="flex min-h-full items-center justify-center">
      <h2 className="font-display text-[32px] leading-none text-ink-muted">
        {title}
      </h2>
    </section>
  );
}
