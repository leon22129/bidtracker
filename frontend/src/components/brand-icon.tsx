import Image from 'next/image';

export function BrandIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      priority
    />
  );
}
