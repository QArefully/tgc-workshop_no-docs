import { cn } from '@/lib/utils';

interface ProductGridProps {
  children: React.ReactNode;
  className?: string;
}

export function ProductGrid({ children, className }: ProductGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-4 gap-y-6 min-[440px]:grid-cols-2 sm:gap-x-5 sm:gap-y-8 lg:grid-cols-4 min-[1440px]:grid-cols-5',
        className,
      )}
    >
      {children}
    </div>
  );
}
