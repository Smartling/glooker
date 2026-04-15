import Link from 'next/link';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="px-5 py-2 text-xs text-gray-500 flex items-center gap-1.5 no-print">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-700">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-accent-light hover:text-accent-lighter transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-300 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
