import { ArrowLeft, Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeaderActions } from '@/components/layout/header-actions';

export function SubpageLayout({ title, children, backHref, showTitle = true }: { title: string; children: React.ReactNode; backHref?: string; showTitle?: boolean }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="h-9 w-9" asChild>
            <Link href={backHref || '/'}>
              {backHref ? <ArrowLeft className="h-4 w-4" /> : <Home className="h-4 w-4" />}
              <span className="sr-only">Back</span>
            </Link>
          </Button>
          {showTitle && <h1 className="font-headline text-xl font-semibold tracking-tight">{title}</h1>}
        </div>
        <HeaderActions />
      </header>
      <main className="flex-1 p-4 md:p-8 lg:p-10">
        <div className="mx-auto w-full max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}
