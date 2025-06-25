import { ArrowLeft, Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeaderActions } from '@/components/layout/header-actions';

export function SubpageLayout({ title, description, children, backHref }: { title: string; description?: string; children: React.ReactNode, backHref?: string }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-10 flex h-auto items-start justify-between gap-4 border-b bg-background/80 px-4 py-4 backdrop-blur-sm md:px-8">
        { backHref && description ? (
            // Special layout for Audio Room with description
            <div>
                <Button variant="outline" size="icon" className="h-9 w-9 mb-2" asChild>
                  <Link href={backHref}>
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back</span>
                  </Link>
                </Button>
                <h1 className="font-headline text-xl font-semibold tracking-tight">{title}</h1>
                <p className="text-muted-foreground text-sm mt-1">{description}</p>
            </div>
          ) : (
            // Original layout for other pages, vertically centered
            <div className="flex items-center gap-4 py-2">
              <Button variant="outline" size="icon" className="h-9 w-9" asChild>
                <Link href={backHref || '/'}>
                  {backHref ? <ArrowLeft className="h-4 w-4" /> : <Home className="h-4 w-4" />}
                  <span className="sr-only">Back</span>
                </Link>
              </Button>
              <h1 className="font-headline text-xl font-semibold tracking-tight">{title}</h1>
            </div>
          )}
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
